// Transport bridge only: no camera driver or recognition model is installed here.
#include <WiFi.h>
#include <WebServer.h>
#include <Preferences.h>
#include <ArduinoJson.h>
#include "UnoProtocol.h"
#if __has_include("config.local.h")
#include "config.local.h"
#else
#include "config.example.h"
#endif

constexpr uint32_t WIFI_TIMEOUT_MS = 15000;
constexpr uint32_t WIFI_RETRY_MS = 30000;
constexpr uint32_t UNO_TIMEOUT_MS = 10000;
WebServer server(80);
Preferences prefs;
HardwareSerial unoSerial(1);
bool storageReady = false;
bool uartReady = false;
bool busy = false;
bool uncertain = true;
bool unoConfirmed = false;
long revision = 0;
uint32_t lastWifiAttempt = 0;
bool wifiWasConnected = false;

struct Event {
  uint32_t seq = 0;
  String kind;
  String detail;
};
Event events[20];
uint32_t eventSeq = 0;

void logEvent(const String &kind, const String &detail) {
  Serial.printf("[%s] %s\n", kind.c_str(), detail.c_str());
  ++eventSeq;
  Event &event = events[eventSeq % 20];
  event.seq = eventSeq;
  event.kind = kind;
  event.detail = detail;
}

void sendJson(int status, const JsonDocument &doc) {
  String body;
  serializeJson(doc, body);
  server.send(status, "application/json", body);
}

void reply(int status, bool ok, const String &detail) {
  JsonDocument doc;
  doc["ok"] = ok;
  doc["detail"] = detail;
  sendJson(status, doc);
}

bool authorized() {
  if (String(TRAY_API_TOKEN).length() < 24 ||
      String(TRAY_API_TOKEN) == "CHANGE_TO_A_LONG_RANDOM_TOKEN" ||
      server.header("Authorization") != String("Bearer ") + TRAY_API_TOKEN) {
    reply(401, false, "A configured device token is required.");
    return false;
  }
  return true;
}

// Never retry: K/OK has no request ID, so a lost reply cannot be safely retried.
bool openBox(int box) {
  if (!UnoProtocol::validBox(box) || !uartReady || !storageReady || busy || uncertain) {
    logEvent("rejected", "Invalid box, UART disabled, busy, or inspection required.");
    return false;
  }
  busy = true;
  if (prefs.putBool("uncertain", true) != 1) {
    uncertain = true;
    busy = false;
    logEvent("storage_error", "Cannot persist command reservation; nothing sent.");
    return false;
  }
  uncertain = true;
  while (unoSerial.available()) unoSerial.read();
  UnoProtocol::CompletionParser parser;
  unoSerial.write(static_cast<uint8_t>(UnoProtocol::command(box)));
  unoSerial.flush();
  logEvent("sent", String("Box ") + box);
  const uint32_t started = millis();
  bool completed = false;
  while (millis() - started < UNO_TIMEOUT_MS) {
    while (unoSerial.available()) {
      if (parser.feed(static_cast<char>(unoSerial.read()))) completed = true;
    }
    if (completed) break;
    delay(1);
  }
  unoConfirmed = completed;
  if (completed && prefs.putBool("uncertain", false) == 1) {
    uncertain = false;
    logEvent("completed", String("K/OK received for box ") + box);
  } else {
    logEvent("inspection_required", completed
      ? "Completion received but flash update failed."
      : "UNO timeout. No retry. Inspect tray, then enter RESET on USB serial.");
  }
  busy = false;
  return completed && !uncertain;
}

// Call from a real vendor SDK callback on the Arduino loop task, never an ISR.
// These booleans must come from verified local policy/recognition, not HTTP input.
bool onRecognitionCompleted(int box, bool faceVerified, bool pillVerified, bool doseAuthorized) {
  if (!faceVerified || !pillVerified || !doseAuthorized) {
    logEvent("recognition_rejected", "Face, pill, and dose policy must all pass.");
    return false;
  }
  return openBox(box);
}

void setupRoutes() {
  const char *headers[] = {"Authorization"};
  server.collectHeaders(headers, 1);
  server.on("/api/status", HTTP_GET, []() {
    JsonDocument doc;
    doc["v"] = 1;
    doc["revision"] = revision;
    doc["rtc"] = "";
    doc["uno"] = unoConfirmed;
    doc["uartReady"] = uartReady;
    doc["inspectionRequired"] = uncertain;
    doc["busy"] = busy;
    doc["protocol"] = "digit-k-ok";
    doc["cameraReady"] = false;
    doc["visionMode"] = "not-integrated";
    doc["faceId"] = -1;
    doc["objectId"] = -1;
    doc["autonomy"] = false;
    sendJson(200, doc);
  });
  server.on("/api/test-open", HTTP_POST, []() {
    if (!authorized()) return;
    const String boxText = server.arg("box");
    if (boxText.length() != 1 || boxText[0] < '1' || boxText[0] > '4') {
      reply(400, false, "box must be exactly 1, 2, 3, or 4.");
      return;
    }
    if (!uartReady || !storageReady) { reply(503, false, "UART GPIO or flash is unavailable."); return; }
    if (busy || uncertain) { reply(409, false, "Inspect tray; RESET via USB serial is required after timeout/reboot."); return; }
    const bool ok = openBox(boxText[0] - '0');
    reply(ok ? 200 : 504, ok, ok ? "UNO completion received." : "Completion uncertain. Do not retry.");
  });
  server.on("/api/config", HTTP_PUT, []() {
    if (!authorized()) return;
    // This transport-only firmware cannot enforce schedules. Do not pretend to sync them.
    reply(501, false, "Schedule/RTC autonomy is not supported by the digit-K/OK protocol.");
  });
  server.on("/api/enroll", HTTP_POST, []() {
    if (!authorized()) return;
    reply(501, false, "Vendor camera recognition SDK is not integrated.");
  });
  server.on("/api/events", HTTP_GET, []() {
    if (!authorized()) return;
    JsonDocument doc;
    JsonArray array = doc["events"].to<JsonArray>();
    const uint32_t after = strtoul(server.arg("after").c_str(), nullptr, 10);
    for (uint32_t seq = eventSeq > 19 ? eventSeq - 19 : 1; seq <= eventSeq; ++seq) {
      const Event &event = events[seq % 20];
      if (seq <= after || event.seq != seq) continue;
      JsonObject entry = array.add<JsonObject>();
      entry["seq"] = seq;
      entry["at"] = "";
      entry["kind"] = event.kind;
      entry["detail"] = event.detail;
    }
    sendJson(200, doc);
  });
  server.on("/", HTTP_GET, []() {
    server.send(200, "text/html; charset=utf-8", R"HTML(<!doctype html>
<html lang="en"><meta name="viewport" content="width=device-width">
<title>Medicare Tray UART test</title>
<h1>Empty-tray test only</h1>
<p>No face/pill AI or dose scheduling. Keep fingers clear of servos.</p>
<label>Device token <input id="token" type="password" autocomplete="off"></label>
<p><button data-box="1">Box 1</button> <button data-box="2">Box 2</button>
<button data-box="3">Box 3</button> <button data-box="4">Box 4</button></p>
<button id="status">Status</button><pre id="result" role="status"></pre>
<script>
const buttons = [...document.querySelectorAll('button')];
async function request(path, options) {
  buttons.forEach(b => b.disabled = true);
  const output = document.getElementById('result');
  output.textContent = 'Waiting... Do not resend.';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(path, {...options, signal: controller.signal});
    output.textContent = response.status + '\n' + await response.text();
  } catch (error) { output.textContent = 'Completion unknown. Inspect tray. ' + error.message; }
  finally { clearTimeout(timer); buttons.forEach(b => b.disabled = false); }
}
document.querySelectorAll('[data-box]').forEach(b => b.onclick = () => request(
  '/api/test-open?box=' + b.dataset.box,
  {method: 'POST', headers: {Authorization: 'Bearer ' + document.getElementById('token').value}}
));
document.getElementById('status').onclick = () => request('/api/status');
</script></html>)HTML");
  });
  server.onNotFound([]() { reply(404, false, "Unknown endpoint."); });
}

void usbConsoleTick() {
  static String line;
  while (Serial.available()) {
    const char c = Serial.read();
    if (c == '\r') continue;
    if (c == '\n') {
      if (line == "RESET" && uartReady && storageReady && !busy) {
        while (unoSerial.available()) unoSerial.read();
        if (prefs.putBool("uncertain", false) == 1) {
          uncertain = false;
          logEvent("reset", "Operator confirmed empty tray and UNO idle.");
        } else logEvent("storage_error", "RESET was not saved.");
      } else if (line.length() == 1 && UnoProtocol::validBox(line[0] - '0')) {
        openBox(line[0] - '0');
      } else if (line.length()) {
        Serial.println("Commands: 1/2/3/4 (empty tray only), RESET (after physical inspection).");
      }
      line = "";
    } else if (line.length() < 32) line += c;
    else { line = ""; Serial.println("USB command too long."); }
  }
}

void setup() {
  Serial.begin(115200);
  Serial.println("\nMedicare Tray - digit / K|OK UART bridge");
  storageReady = prefs.begin("tray", false);
  if (storageReady) uncertain = prefs.getBool("uncertain", false);
  else Serial.println("ERROR: flash unavailable; commands disabled.");
  uartReady = TRAY_UNO_RX_GPIO >= 0 && TRAY_UNO_TX_GPIO >= 0 &&
              TRAY_UNO_RX_GPIO != TRAY_UNO_TX_GPIO &&
              TRAY_UNO_RX_GPIO != 1 && TRAY_UNO_RX_GPIO != 3 &&
              TRAY_UNO_TX_GPIO != 1 && TRAY_UNO_TX_GPIO != 3;
  if (uartReady) {
    unoSerial.begin(9600, SERIAL_8N1, TRAY_UNO_RX_GPIO, TRAY_UNO_TX_GPIO);
    Serial.println("UNO UART enabled at 9600. Verify board pin map and level shifting.");
  } else Serial.println("ERROR: configure board-specific RX/TX GPIO in config.local.h; UART disabled.");
  if (uncertain) Serial.println("Inspection required from previous interrupted command. No automatic retry.");
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  Serial.printf("Connecting to SSID: %s\n", TRAY_WIFI_SSID);
  WiFi.begin(TRAY_WIFI_SSID, TRAY_WIFI_PASSWORD);
  lastWifiAttempt = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - lastWifiAttempt < WIFI_TIMEOUT_MS) delay(100);
  if (WiFi.status() == WL_CONNECTED) {
    wifiWasConnected = true;
    Serial.printf("Wi-Fi connected. Test page: http://%s/\n", WiFi.localIP().toString().c_str());
  } else Serial.println("Wi-Fi connection timed out; retrying in background.");
  setupRoutes();
  server.begin();
}

void loop() {
  server.handleClient();
  usbConsoleTick();
  const bool connected = WiFi.status() == WL_CONNECTED;
  if (connected != wifiWasConnected) {
    wifiWasConnected = connected;
    if (connected) Serial.printf("Wi-Fi connected. Test page: http://%s/\n", WiFi.localIP().toString().c_str());
    else Serial.println("Wi-Fi disconnected; UART still available.");
  }
  if (!connected && millis() - lastWifiAttempt >= WIFI_RETRY_MS) {
    lastWifiAttempt = millis();
    Serial.println("Retrying Wi-Fi...");
    WiFi.reconnect();
  }
  delay(1);
}

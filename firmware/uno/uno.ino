// UNO companion for raw '1'..'4' commands and 'OK\n' completion.
// External servo supply, common GND. D9 -> level shifter -> ESP32 RX.
#include <Servo.h>
#include <SoftwareSerial.h>

constexpr uint8_t SERVO_PINS[] = {3, 5, 6, 10};
constexpr uint8_t CLOSED_DEG = 0;
constexpr uint8_t OPEN_DEG = 90;
constexpr uint32_t OPEN_MS = 4000;
constexpr uint32_t CLOSE_MS = 700;
SoftwareSerial cam(8, 9);  // RX, TX
Servo servos[4];
enum Phase { Idle, Open, Closing };
Phase phase = Idle;
uint8_t activeBox = 0;
uint32_t phaseStarted = 0;

void setup() {
  Serial.begin(115200);
  cam.begin(9600);
  // Calibrate angles on an empty mechanism before attaching medicine trays.
  for (uint8_t i = 0; i < 4; ++i) {
    servos[i].attach(SERVO_PINS[i]);
    servos[i].write(CLOSED_DEG);
    delay(CLOSE_MS);
    servos[i].detach();
  }
  while (cam.available()) cam.read();
  Serial.println("UNO ready: commands 1..4, completion OK after closing delay.");
}

void loop() {
  while (cam.available()) {
    const char c = cam.read();
    if (c == '\r' || c == '\n') continue;
    if (c < '1' || c > '4') { Serial.println("Invalid command ignored."); continue; }
    if (phase != Idle) { Serial.println("Busy: command discarded, not queued."); continue; }
    activeBox = c - '1';
    servos[activeBox].attach(SERVO_PINS[activeBox]);
    servos[activeBox].write(OPEN_DEG);
    phaseStarted = millis();
    phase = Open;
    Serial.print("Opening box "); Serial.println(c);
  }
  if (phase == Open && millis() - phaseStarted >= OPEN_MS) {
    servos[activeBox].write(CLOSED_DEG);
    phaseStarted = millis();
    phase = Closing;
  } else if (phase == Closing && millis() - phaseStarted >= CLOSE_MS) {
    servos[activeBox].detach();
    phase = Idle;
    cam.print("OK\n");
    Serial.println("Close delay complete; OK sent (no physical position sensor).");
  }
}

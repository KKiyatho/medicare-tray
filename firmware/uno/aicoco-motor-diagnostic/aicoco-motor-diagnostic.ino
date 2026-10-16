// Ai COCOCAM + servo bench diagnostic for Arduino UNO.
// Ai COCOCAM communication must be configured to SERIAL 9600.
// Camera TX -> UNO D8 (RX), camera RX <- UNO D9 (TX, level-shift if required),
// and common GND. Keep camera USB-C power independent.
// This sketch reports camera recognition IDs and allows manual empty-tray
// servo tests from the USB serial monitor. It deliberately does not auto-dispense.
#include <COCOCAM.h>
#include <Servo.h>
#include <SoftwareSerial.h>

constexpr uint8_t CAMERA_RX = 8;
constexpr uint8_t CAMERA_TX = 9;
constexpr uint8_t SERVO_PINS[] = {3, 5, 6, 10};
constexpr uint8_t CLOSED_DEG = 0;
constexpr uint8_t OPEN_DEG = 90;
constexpr uint32_t OPEN_MS = 4000;
constexpr uint32_t CLOSE_SETTLE_MS = 700;
constexpr uint32_t CAMERA_POLL_MS = 400;

SoftwareSerial cameraSerial(CAMERA_RX, CAMERA_TX);
COCOCAM camera;
Servo servos[4];

enum MotionPhase : uint8_t { MOTION_IDLE, MOTION_OPEN, MOTION_CLOSING };
MotionPhase motion = MOTION_IDLE;
uint8_t activeServo = 0;
uint32_t motionStarted = 0;
uint32_t lastCameraPoll = 0;
protocolAlgorithm cameraAlgorithm = ALGORITHM_FACE_RECOGNITION;
bool cameraReady = false;

void beginCamera() {
  cameraSerial.begin(9600);
  Serial.println(F("Connecting Ai COCOCAM at 9600 baud..."));
  cameraReady = camera.begin(cameraSerial);
  if (!cameraReady) {
    Serial.println(F("Ai COCOCAM not responding. Check SERIAL 9600, TX/RX, and GND."));
    return;
  }
  if (!camera.writeAlgorithm(cameraAlgorithm)) {
    cameraReady = false;
    Serial.println(F("Camera algorithm command failed."));
    return;
  }
  Serial.println(F("Camera connected; FACE recognition selected."));
}

void selectCameraMode(protocolAlgorithm mode, const __FlashStringHelper *label) {
  if (!cameraReady) {
    Serial.println(F("Camera is not connected."));
    return;
  }
  if (!camera.writeAlgorithm(mode)) {
    Serial.println(F("Camera mode change failed; no motor action."));
    return;
  }
  cameraAlgorithm = mode;
  while (camera.available()) camera.read();
  Serial.print(F("Camera mode: "));
  Serial.println(label);
}

void reportCameraResults() {
  if (!cameraReady || millis() - lastCameraPoll < CAMERA_POLL_MS) return;
  lastCameraPoll = millis();
  if (!camera.request()) {
    Serial.println(F("Camera request failed; ignoring stale results."));
    return;
  }

  const __FlashStringHelper *modeLabel =
      cameraAlgorithm == ALGORITHM_FACE_RECOGNITION ? F("FACE") : F("OBJECT");
  uint8_t detections = 0;
  while (camera.available()) {
    const cococamResult result = camera.read();
    if (result.command != COMMAND_RETURN_BLOCK) continue;
    ++detections;
    Serial.print(modeLabel);
    Serial.print(F(" learned-ID="));
    Serial.print(result.ID);
    Serial.print(F(" center=("));
    Serial.print(result.xCenter);
    Serial.print(',');
    Serial.print(result.yCenter);
    Serial.println(')');
  }
  if (detections == 0) {
    Serial.print(modeLabel);
    Serial.println(F(" no learned target in current frame."));
  }
}

void beginManualMotorTest(uint8_t box) {
  if (box < 1 || box > 4) {
    Serial.println(F("Select servo 1..4."));
    return;
  }
  if (motion != MOTION_IDLE) {
    Serial.println(F("Servo busy; command discarded."));
    return;
  }

  activeServo = box - 1;
  servos[activeServo].attach(SERVO_PINS[activeServo]);
  servos[activeServo].write(OPEN_DEG);
  motionStarted = millis();
  motion = MOTION_OPEN;
  Serial.print(F("BENCH TEST ONLY: opening servo "));
  Serial.println(box);
}

void updateMotor() {
  const uint32_t now = millis();
  if (motion == MOTION_OPEN && now - motionStarted >= OPEN_MS) {
    servos[activeServo].write(CLOSED_DEG);
    motionStarted = now;
    motion = MOTION_CLOSING;
  } else if (motion == MOTION_CLOSING && now - motionStarted >= CLOSE_SETTLE_MS) {
    servos[activeServo].detach();
    motion = MOTION_IDLE;
    Serial.println(F("Close settle delay ended; physical closure is NOT sensor-verified."));
  }
}

void printHelp() {
  Serial.println(F("Commands (USB serial, 115200 baud):"));
  Serial.println(F("  F = Ai COCOCAM face-recognition results"));
  Serial.println(F("  P = Ai COCOCAM object-recognition results"));
  Serial.println(F("  1..4 = manual servo test; use an EMPTY tray only"));
  Serial.println(F("No schedule sync, phone app link, or automatic dispensing."));
}

void handleUsbCommand() {
  while (Serial.available()) {
    const char command = Serial.read();
    if (command == '\r' || command == '\n') continue;
    if (command == 'F' || command == 'f') {
      selectCameraMode(ALGORITHM_FACE_RECOGNITION, F("FACE"));
    } else if (command == 'P' || command == 'p') {
      selectCameraMode(ALGORITHM_OBJECT_RECOGNITION, F("OBJECT"));
    } else if (command >= '1' && command <= '4') {
      beginManualMotorTest(command - '0');
    } else if (command == 'H' || command == 'h' || command == '?') {
      printHelp();
    } else {
      Serial.println(F("Unknown command; enter H for help."));
    }
  }
}

void setup() {
  Serial.begin(115200);
  Serial.println(F("\nAi COCOCAM + servo diagnostic. EMPTY TRAY ONLY."));
  for (uint8_t i = 0; i < 4; ++i) {
    servos[i].attach(SERVO_PINS[i]);
    servos[i].write(CLOSED_DEG);
    delay(CLOSE_SETTLE_MS);
    servos[i].detach();
  }
  beginCamera();
  printHelp();
}

void loop() {
  handleUsbCommand();
  reportCameraResults();
  updateMotor();
}

#pragma once

namespace UnoProtocol {
inline bool validBox(int box) { return box >= 1 && box <= 4; }
inline char command(int box) { return validBox(box) ? static_cast<char>('0' + box) : '\0'; }

class CompletionParser {
 public:
  bool feed(char c) {
    if (c == '\r' || c == '\n') {
      state = Empty;
      return false;
    }
    if (state == Empty && c == 'K') return true;
    if (state == Empty && c == 'O') { state = SawO; return false; }
    if (state == SawO && c == 'K') { state = Empty; return true; }
    state = Invalid;
    return false;
  }

 private:
  enum State { Empty, SawO, Invalid };
  State state = Empty;
};
}

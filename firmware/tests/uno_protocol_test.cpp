#include "../cam/UnoProtocol.h"
#include <assert.h>

bool completes(const char *text) {
  UnoProtocol::CompletionParser parser;
  bool result = false;
  for (; *text; ++text) result = parser.feed(*text) || result;
  return result;
}

int main() {
  for (int box = 1; box <= 4; ++box) {
    assert(UnoProtocol::validBox(box));
    assert(UnoProtocol::command(box) == '0' + box);
  }
  assert(!UnoProtocol::validBox(0));
  assert(!UnoProtocol::validBox(5));
  assert(UnoProtocol::command(-1) == '\0');
  assert(completes("K"));
  assert(completes("OK"));
  assert(completes("OK\r\n"));
  assert(completes("\r\nK\r\n"));
  assert(!completes("O"));
  assert(!completes("BADK"));
  assert(!completes("OOK"));
  assert(!completes("ok"));
  assert(completes("O\nK"));  // A standalone K after newline is valid.
  assert(completes("noise\r\nOK"));
  UnoProtocol::CompletionParser split;
  assert(!split.feed('O'));
  assert(split.feed('K'));  // Separate UART reads, no newline required.
  return 0;
}

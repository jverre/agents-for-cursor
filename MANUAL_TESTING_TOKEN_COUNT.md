# Manual Testing Guide: Token Counting Feature

## Overview
This guide explains how to manually test the token counting feature that tracks input/output tokens including tool calls.

## Prerequisites
1. Cursor installed with the Agents for Cursor extension
2. Extension patches applied via "Agents for Cursor: Enable" command
3. ACP_DEBUG environment variable set (optional, for verbose logging)

## Testing Steps

### Setup

1. **Enable the extension:**
   ```bash
   # In VS Code/Cursor
   Cmd+Shift+P -> "Agents for Cursor: Enable"
   # Restart Cursor when prompted
   ```

2. **Clear the log file (optional):**
   ```bash
   > ~/.cursor-acp.log
   ```

### Test 1: Simple Text Message (Input + Text Output Tokens)

**Expected behavior:** Count tokens for user message and assistant response

1. Open Cursor chat panel
2. Select "Claude Code (ACP)" model
3. Send message: `Hello, how are you?`
4. Wait for response

**Verify in logs:**
```bash
tail -f ~/.cursor-acp.log | grep "📊"
```

**Expected log output:**
```
[ACP Bridge] 📊 Input tokens: 5
[ACP Bridge] 📊 Output breakdown: text=25 toolInput=0 toolOutput=0 total=25
[ACP] 📊 Token usage: {"prompt_tokens":5,"completion_tokens":25,"total_tokens":30,"breakdown":{"text_tokens":25,"tool_input_tokens":0,"tool_output_tokens":0}}
```

**Validation:**
- Input tokens ≈ message length / 4 (e.g., 20 chars ≈ 5 tokens)
- Text tokens > 0
- Tool tokens = 0 (no tools used)

---

### Test 2: File Read (Input + Text + Tool Input + Tool Output Tokens)

**Expected behavior:** Count tokens for message, tool parameters, and file contents

1. Create a test file:
   ```bash
   echo "This is a test file with some content to read" > /tmp/test-token-file.txt
   ```

2. In Cursor chat, send: `Read the file /tmp/test-token-file.txt`
3. Wait for response

**Expected log output:**
```
[ACP Bridge] 📊 Input tokens: 10
[ACP Bridge] 📊 Tool input tokens: 8 | total so far: 8
[ACP Bridge] 📊 Tool output tokens: 12 | total so far: 12
[ACP Bridge] 📊 Output breakdown: text=30 toolInput=8 toolOutput=12 total=50
```

**Validation:**
- Input tokens ≈ message length / 4
- Tool input tokens ≈ file path length / 4
- Tool output tokens ≈ file content length / 4
- Total = text + toolInput + toolOutput

---

### Test 3: Search/Grep (Multiple Tool Calls)

**Expected behavior:** Accumulate tokens across multiple tool calls

1. In Cursor chat, send: `Find all occurrences of "test" in .js files`
2. Wait for response (may take longer due to search)

**Expected log output:**
```
[ACP Bridge] 📊 Input tokens: 12
[ACP Bridge] 📊 Tool input tokens: 5 | total so far: 5
[ACP Bridge] 📊 Tool output tokens: 150 | total so far: 150
[ACP Bridge] 📊 Tool input tokens: 3 | total so far: 8
[ACP Bridge] 📊 Tool output tokens: 200 | total so far: 350
[ACP Bridge] 📊 Output breakdown: text=40 toolInput=8 toolOutput=350 total=398
```

**Validation:**
- Multiple "Tool input tokens" entries (one per tool call)
- Multiple "Tool output tokens" entries (one per tool completion)
- Final breakdown sums all tool calls
- Search results can be large (hundreds of tokens)

---

### Test 4: Edit Tool (Tool Input with Multiple Fields)

**Expected behavior:** Count tokens from all tool input fields (old_string, new_string, file_path)

1. Create a test file:
   ```bash
   echo "foo bar baz" > /tmp/edit-test.txt
   ```

2. In Cursor chat, send: `In /tmp/edit-test.txt, change "foo" to "qux"`
3. Wait for response

**Expected log output:**
```
[ACP Bridge] 📊 Tool input tokens: 15 | total so far: 15
```

**Validation:**
- Tool input tokens should include:
  - file_path: `/tmp/edit-test.txt` (~5 tokens)
  - old_string: `foo` (~1 token)
  - new_string: `qux` (~1 token)
  - Total ≈ 7-15 tokens depending on exact format

---

### Test 5: Bash Command (Tool Input + Progressive Output)

**Expected behavior:** Count command as input, output as tool result

1. In Cursor chat, send: `Run the command: ls -la /tmp`
2. Wait for response

**Expected log output:**
```
[ACP Bridge] 📊 Tool input tokens: 5 | total so far: 5
[ACP Bridge] 📊 Tool output tokens: 50 | total so far: 50
```

**Validation:**
- Tool input tokens ≈ command length / 4
- Tool output tokens ≈ command output length / 4

---

## Token Counting Formula

```
Input Tokens = ceil(user_message.length / 4)

Output Tokens = text_tokens + tool_input_tokens + tool_output_tokens

Where:
  text_tokens = sum(ceil(chunk.length / 4) for each text chunk)
  tool_input_tokens = sum(ceil(stringify(input_values).length / 4) for each tool)
  tool_output_tokens = sum(ceil(result.length / 4) for each tool completion)

Total Tokens = Input Tokens + Output Tokens
```

## Debugging

### View real-time logs:
```bash
tail -f ~/.cursor-acp.log | grep -E "(📊|Token)"
```

### View full token breakdown:
```bash
grep "Token usage:" ~/.cursor-acp.log | tail -1 | jq .
```

### Check if token tracking is working:
```bash
grep "Input tokens:" ~/.cursor-acp.log | tail -5
```

### View tool token details:
```bash
grep "Tool.*tokens:" ~/.cursor-acp.log | tail -10
```

## Expected Token Ranges

| Message Type | Input Tokens | Output Tokens | Notes |
|--------------|--------------|---------------|-------|
| Simple greeting | 2-5 | 20-100 | Minimal response |
| File read (small file) | 5-15 | 50-500 | File content dominates |
| File read (large file) | 5-15 | 1000-10000 | Can be very large |
| Search query | 10-30 | 100-5000 | Depends on results |
| Code edit | 10-50 | 50-300 | Parameters + confirmation |
| Bash command | 5-20 | 50-1000 | Depends on output |

## Common Issues

### No token logs appearing
- Check that extension patches are applied
- Verify extension is running: `lsof -i :37842`
- Check for errors in `~/.cursor-acp.log`

### Token counts seem wrong
- Remember: 1 token ≈ 4 characters (approximation)
- Check if ACP_DEBUG is enabled for verbose output
- Verify tool results are being captured (check for "Tool output tokens" logs)

### Breakdown doesn't sum correctly
- This indicates a bug - check JavaScript console for errors
- Verify all token counting happens in streaming loop

## Success Criteria

✅ Input tokens logged for every message
✅ Text tokens counted for assistant responses
✅ Tool input tokens counted when tools are called
✅ Tool output tokens counted when tools complete
✅ Final breakdown sums correctly
✅ Token usage attached to composer state
✅ All logs appear in ~/.cursor-acp.log

## Next Steps

After manual testing confirms the feature works:
1. Fix automated test environment (Playwright launch issue)
2. Add token limit enforcement (optional)
3. Add UI display for token usage (future enhancement)
4. Consider using actual tokenizer library for accuracy

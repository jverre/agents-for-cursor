# Token Counting - Real Example Walkthrough

## Scenario: User asks to read a file and search for patterns

### User Message
```
"Read the README.md file and find all mentions of 'token'"
```

## Token Flow Visualization

```
┌─────────────────────────────────────────────────────────────┐
│ STEP 1: User Input                                          │
├─────────────────────────────────────────────────────────────┤
│ Message: "Read the README.md file and find all mentions    │
│          of 'token'"                                        │
│                                                             │
│ Length: 62 characters                                      │
│ Tokens: ceil(62 / 4) = 16 tokens                          │
│                                                             │
│ [ACP Bridge] 📊 Input tokens: 16                           │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ STEP 2: Assistant Response (Text)                          │
├─────────────────────────────────────────────────────────────┤
│ Claude: "I'll read the README.md file and search for       │
│         mentions of 'token' for you."                       │
│                                                             │
│ Length: 94 characters                                      │
│ Tokens: ceil(94 / 4) = 24 tokens                          │
│                                                             │
│ textTokens = 24                                            │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ STEP 3: Tool Call #1 - Read File                          │
├─────────────────────────────────────────────────────────────┤
│ Tool: Read                                                  │
│ Input: { file_path: "/path/to/README.md" }                │
│                                                             │
│ Input tokens: ceil(23 / 4) = 6 tokens                     │
│ [ACP Bridge] 📊 Tool input tokens: 6 | total so far: 6    │
│                                                             │
│ ─────────────────────────────────────                      │
│                                                             │
│ Result: "# Token Counting Feature\n\nThis feature         │
│         tracks tokens in messages... [2000 chars]"         │
│                                                             │
│ Output tokens: ceil(2000 / 4) = 500 tokens                │
│ [ACP Bridge] 📊 Tool output tokens: 500 | total so far: 500│
│                                                             │
│ toolInputTokens = 6                                        │
│ toolOutputTokens = 500                                     │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ STEP 4: Tool Call #2 - Grep Search                        │
├─────────────────────────────────────────────────────────────┤
│ Tool: Grep                                                  │
│ Input: {                                                    │
│   pattern: "token",                                        │
│   glob: "README.md"                                        │
│ }                                                           │
│                                                             │
│ Input tokens: ceil(18 / 4) = 5 tokens                     │
│ [ACP Bridge] 📊 Tool input tokens: 5 | total so far: 11   │
│                                                             │
│ ─────────────────────────────────────                      │
│                                                             │
│ Result: [                                                   │
│   "README.md:15: track tokens in messages",               │
│   "README.md:42: token counting utilities",               │
│   "README.md:103: 1 token ≈ 4 characters",               │
│   ... 8 more matches                                       │
│ ]                                                           │
│                                                             │
│ Output tokens: ceil(450 / 4) = 113 tokens                 │
│ [ACP Bridge] 📊 Tool output tokens: 113 | total so far: 613│
│                                                             │
│ toolInputTokens = 11 (6 + 5)                              │
│ toolOutputTokens = 613 (500 + 113)                        │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ STEP 5: More Assistant Text                                │
├─────────────────────────────────────────────────────────────┤
│ Claude: "I found 11 mentions of 'token' in README.md.     │
│         Here's a summary: ..."                              │
│                                                             │
│ Length: 180 characters                                     │
│ Tokens: ceil(180 / 4) = 45 tokens                         │
│                                                             │
│ textTokens = 24 + 45 = 69                                  │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ STEP 6: Final Tally                                        │
├─────────────────────────────────────────────────────────────┤
│ [ACP Bridge] 📊 Output breakdown:                          │
│   text=69                                                   │
│   toolInput=11                                             │
│   toolOutput=613                                           │
│   total=693                                                │
│                                                             │
│ [ACP] 📊 Token usage: {                                    │
│   "prompt_tokens": 16,                                     │
│   "completion_tokens": 693,                                │
│   "total_tokens": 709,                                     │
│   "breakdown": {                                           │
│     "text_tokens": 69,                                     │
│     "tool_input_tokens": 11,                               │
│     "tool_output_tokens": 613                              │
│   }                                                         │
│ }                                                           │
└─────────────────────────────────────────────────────────────┘
```

## Token Breakdown Summary

| Category | Tokens | % of Total | Notes |
|----------|--------|------------|-------|
| **Input** | 16 | 2.3% | User's message |
| **Text Output** | 69 | 9.7% | Claude's explanations |
| **Tool Inputs** | 11 | 1.6% | File path + search pattern |
| **Tool Outputs** | 613 | 86.4% | File contents + search results |
| **TOTAL** | 709 | 100% | - |

## Key Insights

### 🎯 Tool outputs dominate token usage
In this example, **86.4%** of output tokens came from tool results (file contents + search results). This is typical - tools often return large amounts of data.

### 📝 Text is relatively cheap
Claude's actual text responses only used 69 tokens (9.7%). The expensive part is reading and searching files.

### 💡 Input is minimal
The user's message was only 16 tokens. Most tokens are in the response.

### 🔧 Tool inputs are small
Tool parameters (file paths, patterns) are usually small - only 11 tokens here.

## What If the README was 50KB?

```
File content: 50,000 characters → 12,500 tokens!

New breakdown:
  Input: 16 tokens
  Text: 69 tokens
  Tool inputs: 11 tokens
  Tool outputs: 12,613 tokens (file content dominates)
  TOTAL: 12,709 tokens (6.4% of Claude's 200k context!)
```

This is why token tracking matters - large file reads can quickly consume context.

## Real Log Output

Here's what you'd actually see in `~/.cursor-acp.log`:

```
[ACP Bridge] sendMessage called with provider: sonnet-4-5 composerId: abc123
[ACP Bridge] 📊 Input tokens: 16
[ACP Bridge] 📡 Starting streaming response...
[ACP Bridge] Stream chunk: text
[ACP Bridge] Stream chunk: tool
[ACP Bridge] 🔧 Tool event: tool_call | id: def456 | status: pending | kind: read
[ACP Bridge] 📊 Tool input tokens: 6 | total so far: 6
[ACP Bridge] Stream chunk: tool
[ACP Bridge] 🔧 Tool event: tool_call_update | id: def456 | status: completed | kind: read
[ACP Bridge] 📊 Tool output tokens: 500 | total so far: 500
[ACP Bridge] Stream chunk: text
[ACP Bridge] Stream chunk: tool
[ACP Bridge] 🔧 Tool event: tool_call | id: ghi789 | status: pending | kind: search
[ACP Bridge] 📊 Tool input tokens: 5 | total so far: 11
[ACP Bridge] Stream chunk: tool
[ACP Bridge] 🔧 Tool event: tool_call_update | id: ghi789 | status: completed | kind: search
[ACP Bridge] 📊 Tool output tokens: 113 | total so far: 613
[ACP Bridge] Stream chunk: text
[ACP Bridge] Stream chunk: done
[ACP Bridge] ✅ Stream done marker received
[ACP Bridge] 📊 Output breakdown: text=69 toolInput=11 toolOutput=613 total=693
[ACP Bridge] 📡 Stream completed in 3421 ms | text length: 276
[ACP] 📊 Token usage: {"prompt_tokens":16,"completion_tokens":693,"total_tokens":709,"breakdown":{"text_tokens":69,"tool_input_tokens":11,"tool_output_tokens":613}}
[ACP] ✅ end_turn received
[ACP] Message completed successfully
```

## Try It Yourself!

1. Enable patches: `Cmd+Shift+P` → "Agents for Cursor: Enable"
2. Start watching logs: `tail -f ~/.cursor-acp.log | grep "📊"`
3. Send a message: "Read the README.md file"
4. Watch the tokens get counted in real-time!

Each tool call will show:
- Tool input tokens (parameters)
- Tool output tokens (results)
- Running totals
- Final breakdown

Happy token counting! 🎉

# Cursor Conversation Messages Format

## Message Data Structure

### Core Message Types

Cursor uses an enum `Va` for message types:

```javascript
enum Va {
    HUMAN = "HUMAN",  // User messages
    AI = "AI"         // Assistant/AI responses
}
```

### Individual Message Format

Each message (bubble) in the conversation has this structure:

```javascript
{
    bubbleId: string,              // Unique identifier for this message
    type: Va.HUMAN | Va.AI,        // Message type
    text: string,                   // Plain text content
    richText?: string,              // Rich text/markdown content (JSON stringified Lexical state)
    timestamp: number,              // Unix timestamp

    // Context and metadata
    contextSessionUuid?: string,    // Context tracking ID
    contextWindowStatusAtCreation?: object,
    cachedConversationSummary?: string,

    // For AI messages
    requestId?: string,             // Request ID for this generation
    modelName?: string,             // Model used (e.g., "claude-sonnet-4.5")
    thinking?: string,              // AI thinking process (if enabled)

    // For HUMAN messages
    selections?: Array,             // Code selections
    images?: Array,                 // Attached images
    links?: Array,                  // Referenced URLs
    docs?: Array,                   // Documentation references
    commits?: Array,                // Git commits

    // Error handling
    errorDetails?: {
        error: string,
        message: string,
        stackTrace?: string,
        showUsagePricingOptions?: boolean
    }
}
```

### Full Conversation Structure

```javascript
{
    composerId: string,
    conversationId: string,

    // Array of message headers (lightweight references)
    fullConversationHeadersOnly: [
        {
            bubbleId: string,
            type: Va.HUMAN | Va.AI,
            timestamp: number
        },
        // ... more messages
    ],

    // Full message data keyed by bubbleId
    conversationMap: {
        [bubbleId: string]: {
            // Full message object as shown above
        }
    },

    // Metadata
    name?: string,                  // Conversation title
    text: string,                   // Current input text
    richText?: string,              // Current input rich text

    modelConfig?: {
        modelName: string,
        maxMode: boolean,
        thinkingLevel: number
    },

    unified_mode: UnifiedMode,      // CHAT, AGENT, EDIT, PLAN, DEBUG
    isChat: boolean,
    isAgentic: boolean,

    // Context
    contextSessionUuid?: string,

    // Version tracking
    _v: number                      // Data structure version
}
```

## How Messages Are Sent

### When You Start a Chat

**IMPORTANT:** Cursor sends **ALL messages** from the conversation history, not just the most recent one.

**Evidence from code (Line 214906+):**

```javascript
// Build grouped messages for API
function buildConversationGroups(conversationMessages) {
    const groups = [];
    let currentHumanGroup = {
        kind: Va.HUMAN,
        messages: []
    };
    let currentAiGroup = undefined;

    for (const message of conversationMessages) {
        if (message.type === Va.HUMAN) {
            // Add to human message group
            currentHumanGroup.messages.push(message);
        } else if (message.type === Va.AI) {
            if (currentAiGroup === undefined) {
                currentAiGroup = {
                    kind: Va.AI,
                    messages: []
                };
            }
            currentAiGroup.messages.push(message);
        }
    }

    return groups;
}
```

### Actual API Request Format

When sending to the backend API, messages are converted to this format:

```javascript
{
    // Full conversation history
    conversation: [
        {
            kind: "HUMAN",
            messages: [
                {
                    bubbleId: "bubble-123",
                    text: "How do I implement authentication?",
                    // ... other fields
                }
            ]
        },
        {
            kind: "AI",
            messages: [
                {
                    bubbleId: "bubble-124",
                    text: "Here's how to implement authentication...",
                    // ... other fields
                }
            ]
        },
        {
            kind: "HUMAN",
            messages: [
                {
                    bubbleId: "bubble-125",
                    text: "Can you show me the login route?",
                    // ... other fields
                }
            ]
        }
        // ... MORE MESSAGES CONTINUE
    ],

    // Additional request context
    conversationId: "conv-xyz",
    contextSessionUuid: "ctx-abc",
    unified_mode: 1, // CHAT
    model: "claude-sonnet-4.5",
    thinking_level: 0,

    // Current input (already included in conversation array above)
    // but sometimes sent separately for compatibility
    firstUserMessages: [...],
    conversationMessages: [...]
}
```

## Message Sending Behavior

### 1. **Complete History Sent Every Time**

```javascript
// From line 256861+: getConversationFromBubble
async getConversationFromBubble(composerData, bubbleId) {
    const headers = composerData.fullConversationHeadersOnly;

    // Find the bubble index
    const bubbleIndex = headers.findIndex(h => h.bubbleId === bubbleId);

    // Get ALL messages from start to this bubble
    const messagesUpToBubble = headers
        .slice(0, bubbleIndex + 1)
        .map(header => composerData.conversationMap[header.bubbleId])
        .filter(msg => msg !== undefined);

    return messagesUpToBubble; // Returns FULL conversation
}
```

### 2. **Why Full History?**

- **Context Preservation:** AI needs full conversation context
- **Continuation:** Each response builds on previous exchanges
- **Branching:** Supports editing middle messages and replaying
- **Checkpoints:** Can resume from any point in conversation

### 3. **Optimization: Conversation Summarization**

For very long conversations, Cursor may:

```javascript
{
    // Summarized older messages
    cachedConversationSummary: "User asked about authentication. I explained OAuth2 flow...",

    // Recent full messages
    conversation: [
        // Last N messages in full detail
    ]
}
```

## Example: Multi-Turn Conversation

### Turn 1 - User asks:
```json
{
    "conversation": [
        {
            "kind": "HUMAN",
            "messages": [{
                "text": "How do I create a React component?",
                "bubbleId": "msg-1"
            }]
        }
    ]
}
```

### Turn 2 - AI responds, then user follows up:
```json
{
    "conversation": [
        {
            "kind": "HUMAN",
            "messages": [{
                "text": "How do I create a React component?",
                "bubbleId": "msg-1"
            }]
        },
        {
            "kind": "AI",
            "messages": [{
                "text": "Here's how to create a React component:\n\n```jsx\nfunction MyComponent() {\n  return <div>Hello</div>;\n}\n```",
                "bubbleId": "msg-2"
            }]
        },
        {
            "kind": "HUMAN",
            "messages": [{
                "text": "Can you add props?",
                "bubbleId": "msg-3"
            }]
        }
    ]
}
```

### Turn 3 - Continues building on full history:
```json
{
    "conversation": [
        {
            "kind": "HUMAN",
            "messages": [{
                "text": "How do I create a React component?",
                "bubbleId": "msg-1"
            }]
        },
        {
            "kind": "AI",
            "messages": [{
                "text": "Here's how to create a React component...",
                "bubbleId": "msg-2"
            }]
        },
        {
            "kind": "HUMAN",
            "messages": [{
                "text": "Can you add props?",
                "bubbleId": "msg-3"
            }]
        },
        {
            "kind": "AI",
            "messages": [{
                "text": "Sure! Here's with props:\n\n```jsx\nfunction MyComponent({ name }) {\n  return <div>Hello {name}</div>;\n}\n```",
                "bubbleId": "msg-4"
            }]
        },
        {
            "kind": "HUMAN",
            "messages": [{
                "text": "Now add useState",
                "bubbleId": "msg-5"
            }]
        }
    ]
}
```

**Notice:** Each request contains **ALL** previous messages, not just the new one!

## Storage Format

### Local Storage Structure

```javascript
// Stored in browser/electron storage
{
    composerData: {
        [composerId]: {
            composerId: string,
            name: string,
            fullConversationHeadersOnly: [...],
            conversationMap: {...},
            text: string,
            richText: string,
            modelConfig: {...},
            timestamp: number,
            _v: 6  // Current schema version
        }
    }
}
```

### Message Storage Service

**Location:** Line 214369+

```javascript
// Get initial messages for loading
async getInitialMessages(composerId, headers) {
    // Load full conversation data
    const messages = headers.map(h =>
        this.conversationMap[h.bubbleId]
    ).filter(Boolean);

    return messages;
}
```

## Key Differences from Standard Chat APIs

### Standard OpenAI/Anthropic Format:
```json
{
    "messages": [
        {"role": "user", "content": "Hello"},
        {"role": "assistant", "content": "Hi there!"},
        {"role": "user", "content": "How are you?"}
    ]
}
```

### Cursor's Format:
```json
{
    "conversation": [
        {
            "kind": "HUMAN",
            "messages": [
                {
                    "bubbleId": "123",
                    "text": "Hello",
                    "richText": "...",
                    "contextSessionUuid": "...",
                    "selections": [...],
                    "images": [...]
                }
            ]
        },
        {
            "kind": "AI",
            "messages": [
                {
                    "bubbleId": "124",
                    "text": "Hi there!",
                    "modelName": "claude-sonnet-4.5",
                    "thinking": "..."
                }
            ]
        }
    ]
}
```

**Key Differences:**
1. ✅ **Groups messages** by sender type
2. ✅ **Rich metadata** per message (bubbleId, context, selections)
3. ✅ **Multiple messages per turn** (can have multiple HUMAN messages before AI responds)
4. ✅ **Full conversation** sent every time, not incremental
5. ✅ **Context session tracking** across messages
6. ✅ **Attached files/images/commits** in each message

## Summary

**Q: Does it send all messages or just most recent?**
**A: ALL MESSAGES** from the start of the conversation up to the current point.

**Q: What format are the messages in?**
**A: Grouped by message type (HUMAN/AI) with rich metadata including:**
- Text content (plain and rich/markdown)
- Bubble IDs for tracking
- Context session UUIDs
- Attached files, images, selections
- Model names and thinking processes
- Error details and status

**Q: How is this different from standard chat APIs?**
**A: Much richer structure with:**
- Message grouping by kind
- Full conversation history
- Extensive metadata per message
- Multi-modal content support
- Context session tracking

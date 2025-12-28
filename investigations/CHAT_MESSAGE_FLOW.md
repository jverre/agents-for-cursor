# Cursor Chat Message Flow Analysis

## Complete Request Flow

### 1. User Input → Composer Service

**Entry Point:** User types in composer and hits submit

**File:** `workbench.beautified.js`

**Flow:**
```javascript
// Line 471547: submitChatMaybeAbortCurrent
async submitChatMaybeAbortCurrent(composerId, text, options, signal) {
    // Main entry point for all chat submissions
    // Handles abort logic, context processing
    // Builds the final request
}
```

### 2. Chat Provider Service

**File:** `workbench.beautified.js` (Line 761769+)

**Key Components:**

```javascript
class LanguageModelProvider {
    constructor() {
        this._chatProviderService = chatProviderService;
        this._proxy = extensionHostProxy.getProxy(ProxyType.ExtHostChatProvider);
    }

    // Line 761781: Register language model chat
    $registerLanguageModelProvider(extensionId, providerId, metadata) {
        this._chatProviderService.registerLanguageModelChat(providerId, {
            metadata: metadata,

            // THIS IS THE KEY INTERCEPTION POINT
            sendChatRequest: async (messages, options, token, cancellation) => {
                const requestId = Math.random() * 1e6 | 0;
                const deferred = new Promise();
                const stream = new AsyncIterableStream();

                // Store pending progress
                this._pendingProgress.set(requestId, {
                    defer: deferred,
                    stream: stream
                });

                // Process images
                await Promise.all(messages.flatMap(m => m.content)
                    .filter(c => c.type === "image_url")
                    .map(async (img) => {
                        img.value.data = Buffer.wrap(await convertImage(img.value.data.buffer));
                    }));

                // SEND TO EXTENSION HOST PROXY
                await this._proxy.$startChatRequest(
                    extensionId,
                    requestId,
                    options,
                    new ChatMessages(messages),
                    token,
                    cancellation
                );

                return {
                    result: deferred.promise,
                    stream: stream.asyncIterable
                };
            },

            provideTokenCount: (text, token) =>
                this._proxy.$provideTokenLength(extensionId, text, token)
        });
    }

    // Line 761830: Actual send implementation
    async sendChatRequest(providerId, messages, options, token, cancellation) {
        // Delegates to registered provider
        const provider = this.getProvider(providerId);
        return provider.sendChatRequest(messages, options, token, cancellation);
    }
}
```

### 3. Stream Unified Chat Request

**Request Building:** (Line 472501+)

```javascript
// Build the unified chat request
const chatRequest = {
    messages: conversationMessages,
    model: modelConfig.modelName,
    unified_mode: composerMode, // CHAT, AGENT, EDIT, PLAN, DEBUG
    thinking_level: thinkingLevel, // UNSPECIFIED, MEDIUM, HIGH
    contextSessionUuid: contextSessionUuid,
    useReranker: shouldUseReranker,
    useWeb: useWebSearch,
    // ... other options
};

// Line 472609: Send to AI service
const stream = aiService.streamUnifiedChatWithTools(chatRequest, {
    signal: abortSignal,
    headers: authHeaders
});
```

### 4. AI Service Layer

**Service:** `AIService` (Line 426875+)

```javascript
class AIService {
    constructor() {
        this.baseUrl = "https://api2.cursor.sh"; // CONFIGURABLE
    }

    // Line 426875: Stream endpoints
    streamUnifiedChatWithTools: {
        // gRPC/HTTP endpoint definition
        path: "/aiserver.v1.AIService/StreamUnifiedChatWithTools"
    },

    streamUnifiedChatWithToolsIdempotent: {
        // Idempotent version for retries
        path: "/aiserver.v1.AIService/StreamUnifiedChatWithToolsIdempotent"
    },

    streamUnifiedChatWithToolsSSE: {
        // Server-Sent Events version
        path: "/aiserver.v1.AIService/StreamUnifiedChatWithToolsSSE"
    },

    streamUnifiedChatWithToolsPoll: {
        // Polling version
        path: "/aiserver.v1.AIService/StreamUnifiedChatWithToolsPoll"
    }
}
```

### 5. Response Streaming

**Response Handler:** (Line 761806+)

```javascript
async $reportResponsePart(requestId, responsePart) {
    const pending = this._pendingProgress.get(requestId);

    if (pending) {
        // Emit partial response
        pending.stream.emitOne(responsePart);
    }
}

async $reportResponseDone(requestId, error) {
    const pending = this._pendingProgress.get(requestId);

    if (pending) {
        this._pendingProgress.delete(requestId);

        if (error) {
            const deserializedError = tryDeserialize(error);
            pending.stream.reject(deserializedError);
            pending.defer.error(deserializedError);
        } else {
            pending.stream.resolve();
            pending.defer.complete();
        }
    }
}
```

## Interception Points for Redirecting to Custom Provider

### Option 1: Modify Chat Provider Service (RECOMMENDED)

**Location:** Line 761781 - `registerLanguageModelChat`

**Strategy:** Replace the `sendChatRequest` function to route to your custom backend

```javascript
sendChatRequest: async (messages, options, token, cancellation) => {
    // YOUR CUSTOM LOGIC HERE
    const customBackendUrl = "https://your-api.example.com/v1/chat";

    const response = await fetch(customBackendUrl, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${yourApiKey}`
        },
        body: JSON.stringify({
            messages: messages,
            model: options.model,
            stream: true
        }),
        signal: cancellation
    });

    // Convert your response to Cursor's expected format
    return {
        result: processResponse(response),
        stream: convertToAsyncIterable(response.body)
    };
}
```

### Option 2: Proxy Layer Modification

**Location:** Line 426875 - AIService configuration

**Strategy:** Change the base URL or intercept gRPC calls

```javascript
class AIService {
    constructor() {
        // CHANGE THIS
        this.baseUrl = process.env.CURSOR_CUSTOM_BACKEND || "https://api2.cursor.sh";
    }
}
```

### Option 3: Network Layer Interception

**Location:** Extension level or Electron network layer

**Strategy:** Use Electron's `session.webRequest` API to intercept HTTP calls

```javascript
// In main process
const { session } = require('electron');

session.defaultSession.webRequest.onBeforeRequest(
    { urls: ['https://api2.cursor.sh/*'] },
    (details, callback) => {
        // Redirect to your backend
        callback({
            redirectURL: details.url.replace(
                'api2.cursor.sh',
                'your-api.example.com'
            )
        });
    }
);
```

## API Endpoints Configuration

### Primary Endpoints (product.json)

```json
{
  "updateUrl": "https://api2.cursor.sh/updates",
  "statsigLogEventProxyUrl": "https://api3.cursor.sh/tev1/v1",
  "controlUrl": "https://api2.cursor.sh/extensions-control"
}
```

### Chat Service Endpoints

**Base URL:** `https://api2.cursor.sh`

**gRPC Services:**
- `/aiserver.v1.AIService/StreamUnifiedChatWithTools` - Main streaming endpoint
- `/aiserver.v1.AIService/StreamUnifiedChatWithToolsIdempotent` - Retry-safe version
- `/aiserver.v1.AIService/StreamUnifiedChatWithToolsSSE` - Server-sent events
- `/aiserver.v1.AIService/StreamUnifiedChatWithToolsPoll` - Polling fallback

### Authentication

**Credentials Manager:** (Line 761769+)

```javascript
// Cursor uses credential manager
const credentials = cursor.getCursorCreds();
const backendUrl = credentials?.backendUrl ?? "https://api2.cursor.sh";
```

## Request/Response Format

### StreamUnifiedChatRequest

**Type Definition:** (Line 444034)

```protobuf
message StreamUnifiedChatRequest {
    repeated Message messages = 1;
    string model = 2;
    UnifiedMode unified_mode = 3;  // CHAT=1, AGENT=2, EDIT=3, CUSTOM=4, PLAN=5, DEBUG=6
    ThinkingLevel thinking_level = 4;  // UNSPECIFIED=0, MEDIUM=1, HIGH=2
    string context_session_uuid = 5;
    bool use_reranker = 6;
    bool use_web = 7;
    repeated ContextItem context = 8;
    // ... more fields
}

enum UnifiedMode {
    UNSPECIFIED = 0;
    CHAT = 1;
    AGENT = 2;
    EDIT = 3;
    CUSTOM = 4;
    PLAN = 5;
    DEBUG = 6;
}

enum ThinkingLevel {
    UNSPECIFIED = 0;
    MEDIUM = 1;
    HIGH = 2;
}
```

### StreamUnifiedChatResponse

**Response Types:** (Line 471228+)

```javascript
{
    response: {
        case: "streamUnifiedChatResponse",
        value: {
            text: "AI response text",
            thinking: "AI thinking process",
            finish_reason: "stop" | "length" | "tool_calls",
            tool_calls: [...],
            usage: {
                prompt_tokens: 123,
                completion_tokens: 456
            }
        }
    }
}
```

## Summary

### Key Interception Points (in order of preference):

1. **Chat Provider Service** (Line 761781)
   - Most reliable
   - Full control over request/response
   - Can transform data formats

2. **AI Service Base URL** (Line 426875)
   - Simple URL replacement
   - Must implement compatible API

3. **Extension Proxy** (Line 761769)
   - Low-level interception
   - Complex to implement

4. **Network Layer** (Electron level)
   - Most transparent
   - Requires main process access

### Files to Modify:

1. `out/vs/workbench/workbench.desktop.main.js` - Main chat logic
2. `product.json` - API endpoint configuration
3. Extension level code (if creating custom extension)

### Next Steps:

1. Choose interception strategy based on your requirements
2. Implement custom backend that matches Cursor's API format
3. Test with simple queries first
4. Handle streaming responses correctly
5. Implement authentication/authorization

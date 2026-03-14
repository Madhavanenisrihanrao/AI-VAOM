# AI-VAOM System Documentation

## Overview
The AI-Driven Voice Activated Order Management (AI-VAOM) system is a sophisticated voice interface that converts natural speech into actionable database operations using advanced AI processing.

## System Architecture

### Backend (Node.js + Express + Supabase)
- **AI-VAOM Engine**: Smart assistant logic with context memory
- **Session Management**: Tracks `last_order_id` for pronoun resolution
- **Smart Clarification**: Asks specific questions when information is missing
- **Error Handling**: Rejects gibberish and unrelated commands
- **CRUD Operations**: Full order management with Supabase integration

### Frontend (Web Speech API + JavaScript)
- **Voice Recognition**: Real-time speech-to-text conversion
- **Hot Microphone**: Automatically activates for clarification responses
- **Visual Feedback**: Animations, toasts, and status indicators
- **Text-to-Speech**: Natural voice responses
- **Context Awareness**: Maintains session state across interactions

## AI-VAOM System Prompt Logic

### Core Capabilities
1. **Action Mapping**: Maps speech to CREATE, UPDATE, TRACK, DELETE, CLARIFY, or REJECT
2. **Context Memory**: Handles pronouns ("it", "that", "undo") using `last_order_id`
3. **Smart Clarification**: Asks specific questions for missing information
4. **Error Handling**: Detects and rejects gibberish/unrelated content

### Response Schema
```json
{
  "action": "CREATE | UPDATE | TRACK | DELETE | CLARIFY | REJECT",
  "data": {
    "order_id": number | null,
    "item": "string" | null,
    "quantity": number | null,
    "changes": "string" | null
  },
  "voice_response": "Natural spoken confirmation or question",
  "dashboard_hint": "UI toast notification text"
}
```

## Voice Command Examples

### CREATE Operations
- **Input**: "I want to buy some burgers."
- **Response**: `{"action": "CLARIFY", "data": {"item": "burger"}, "voice_response": "Great choice! How many burgers would you like?"}`

- **Input**: "Three pizzas"
- **Response**: `{"action": "CREATE", "data": {"item": "pizza", "quantity": 3}, "voice_response": "Placing an order for three pizzas."}`

### Context Memory (Pronouns)
- **Context**: Last order ID = 45
- **Input**: "Cancel it"
- **Response**: `{"action": "DELETE", "data": {"order_id": 45}, "voice_response": "Cancelling order 45."}`

- **Context**: Last order ID = 45
- **Input**: "Where is that?"
- **Response**: `{"action": "TRACK", "data": {"order_id": 45}, "voice_response": "Checking the status of order 45."}`

### Smart Clarification
- **Input**: "Order a pizza"
- **Response**: `{"action": "CLARIFY", "data": {"item": "pizza"}, "voice_response": "Great choice! How many pizzas would you like?"}`

- **Follow-up**: "Two"
- **Response**: `{"action": "CREATE", "data": {"item": "pizza", "quantity": 2}, "voice_response": "Placing an order for two pizzas."}`

### Error Handling (REJECT)
- **Input**: "asdfghjkl"
- **Response**: `{"action": "REJECT", "data": null, "voice_response": "Sorry, I didn't understand that. Please try again."}`

- **Input**: "What's the weather like?"
- **Response**: `{"action": "REJECT", "data": null, "voice_response": "Sorry, I can only help with order management."}`

## API Endpoints

### Voice Processing
- `POST /api/voice-intent` - Process voice commands with AI-VAOM logic
  ```json
  {
    "command": "Order two pizzas",
    "sessionId": "user-abc123"
  }
  ```

### Session Management
- `GET /api/session/:sessionId/context` - Get session context
- `DELETE /api/session/:sessionId/context` - Clear session context

### Order Management
- `GET /api/orders` - Get all orders
- `POST /api/orders` - Create order
- `PATCH /api/orders/:id` - Update order
- `DELETE /api/orders/:id` - Delete order

## Frontend Features

### Voice Interface
- **Microphone Button**: Visual feedback with recording animation
- **Status Indicators**: Real-time processing states
- **Transcript Display**: Shows recognized speech
- **Dashboard Hints**: Toast notifications for user feedback

### Clarification Flow
1. User says "Order a pizza"
2. System asks "How many pizzas would you like?"
3. Microphone automatically reactivates (hot)
4. User responds "Two"
5. System processes complete order

### Visual Feedback
- **Recording**: Pulsing red microphone
- **Processing**: Spinner animation
- **Clarification**: Orange microphone with "Waiting for response..."
- **Success**: Confetti animation
- **Error**: Red toast notification

## Setup Instructions

### Backend Setup
1. Install dependencies: `npm install`
2. Configure `.env` with Supabase credentials
3. Create `orders` table in Supabase
4. Start server: `npm run dev`

### Frontend Setup
1. Open `index.html` in Chrome (recommended for Web Speech API)
2. Allow microphone permissions when prompted
3. Click the microphone button to start

## Advanced Features

### Context Memory System
- Maintains `last_order_id` across session
- Handles pronoun resolution ("it", "that", "undo")
- Automatic context updates after each action

### Gibberish Detection
- Pattern matching for non-meaningful input
- Keyword validation for order-related content
- Graceful rejection with helpful suggestions

### Hot Microphone
- Automatically activates for clarification responses
- Visual indication with orange color
- Timeout protection to prevent infinite listening

## Error Recovery
- Automatic retry on speech recognition errors
- Fallback to manual input if needed
- Session context preservation across errors
- Clear error messages with suggested actions

This system provides a natural, conversational interface for order management with intelligent AI processing and robust error handling.

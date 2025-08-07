# MineCash Backend Architecture Documentation

## 🏗️ System Overview

The MineCash backend is a **modular, scalable gaming platform** built with Node.js that supports multiple casino games with real-time WebSocket communication. The architecture follows **SOLID principles** with clear separation of concerns and is designed for easy game addition and maintenance.

## 📁 Directory Structure

```
Minecash-backend/
├── server/
│   ├── core/                    # Core system components
│   │   ├── game-engine.js      # Main orchestrator
│   │   ├── config-manager.js   # Centralized config management
│   │   ├── memory-manager.js   # Memory cleanup & optimization
│   │   └── event-bus.js       # Inter-game communication
│   ├── games/                  # Game implementations
│   │   ├── base-game.js       # Abstract base class
│   │   ├── crash-game.js      # Crash game implementation
│   │   └── game-template.js   # Template for new games
│   ├── websocket-server.js    # Real-time communication hub
│   ├── game-loop-engine.js    # Legacy compatibility layer
│   └── database-service.js    # Database operations
├── services/                   # Shared services
│   ├── chat-manager.js        # Chat system management
│   └── session-manager.js     # User session management
├── config/
│   └── game-config.js         # Game configuration system
└── NEW_ARCHITECTURE_MIGRATION.md  # Migration guide
```

## 🔧 Core Components

### **1. `server/core/game-engine.js` - Main Orchestrator**
**Purpose**: Central hub that manages all game instances and provides unified interface

**Key Responsibilities**:
- **Game Registry**: Maps game types to their implementations
- **Game Lifecycle**: Initializes, manages, and stops game instances
- **Unified API**: Provides consistent interface for all game operations
- **Service Coordination**: Coordinates between database, config, and event systems

**Key Methods**:
- `initializeGame(gameType, gameId)` - Creates and starts new game instances
- `processBet(gameId, userId, betData)` - Routes bets to appropriate games
- `processGameAction(gameId, userId, action)` - Handles game actions (cashout, etc.)
- `getGameState(gameId, userId)` - Retrieves current game state

**Architecture Role**: **Orchestrator** - Coordinates all game operations and provides unified interface

---

### **2. `server/games/base-game.js` - Abstract Base Class**
**Purpose**: Defines common interface and functionality for ALL games

**Key Responsibilities**:
- **Abstract Interface**: Defines methods all games MUST implement
- **Common Logic**: Handles shared functionality (validation, user bans, etc.)
- **Game Loop Management**: Standardized 60 FPS game loop
- **Event System**: Unified event emission for all games
- **Memory Management**: Automatic cleanup and resource management

**Abstract Methods** (must be implemented by subclasses):
- `getGameType()` - Return game type identifier
- `onInitialize()` - Game-specific initialization
- `onGameLoop()` - Game-specific game loop logic
- `onProcessBet(userId, betData)` - Handle bet processing
- `onProcessAction(userId, action, data)` - Handle game actions
- `onProcessCashout(userId, cashoutValue)` - Handle cashouts
- `onProcessAutoCashout(userId, targetValue)` - Handle auto-cashouts
- `onGetState(userId)` - Return game state
- `onGetHistory(limit)` - Return game history

**Architecture Role**: **Foundation** - Provides common interface and shared functionality

---

### **3. `server/games/crash-game.js` - Real Game Implementation**
**Purpose**: Actual crash game implementation using the base system

**Key Responsibilities**:
- **Crash Logic**: Implements crash-specific game mechanics
- **High-Frequency Processing**: Auto-cashout processing every 8ms
- **Real-Time State**: Manages multiplier calculation and crash points
- **Database Integration**: Handles crash-specific database operations
- **WebSocket Broadcasting**: Real-time state updates to clients

**Key Features**:
- **Precision Multiplier**: `1.0024 * Math.pow(1.0718, timeElapsed)`
- **Auto-Cashout System**: High-frequency checks with retry logic
- **Crash Point Generation**: Cryptographically secure crash points
- **State Persistence**: Database-backed game state management

**Architecture Role**: **Implementation** - Real game using the base system

---

### **4. `server/games/game-template.js` - Development Template**
**Purpose**: Complete example showing how to implement new games

**Key Responsibilities**:
- **Development Guide**: Shows exact patterns for new game implementation
- **Best Practices**: Demonstrates proper error handling and validation
- **Database Integration**: Shows how to use generic database functions
- **State Management**: Example of proper game state handling
- **Auto-Cashout Example**: Shows auto-cashout implementation patterns

**Key Features**:
- **Complete Implementation**: All abstract methods fully implemented
- **Realistic Logic**: Shows actual game loop patterns
- **Error Handling**: Demonstrates proper error management
- **Validation Examples**: Shows bet and action validation

**Architecture Role**: **Development Aid** - Template for creating new games

---

### **5. `server/websocket-server.js` - Real-Time Communication Hub**
**Purpose**: Handles all WebSocket connections and real-time events

**Key Responsibilities**:
- **Connection Management**: Handles WebSocket connections and disconnections
- **Message Routing**: Routes different message types to appropriate handlers
- **Room Management**: Manages game rooms and user connections
- **Rate Limiting**: Prevents spam and abuse
- **Real-Time Broadcasting**: Sends updates to connected clients

**Key Features**:
- **Keep-Alive System**: Maintains connection health
- **Memory Monitoring**: Automatic cleanup and garbage collection
- **Rate Limiting**: 10 messages per 10-second window
- **Graceful Shutdown**: Proper cleanup on server shutdown

**Message Types Handled**:
- `join_game` - User joins a game room
- `place_bet` - User places a bet
- `game_action` - User performs game action (cashout, etc.)
- `chat_message` - User sends chat message
- `request_game_state` - User requests current game state

**Architecture Role**: **Communication Layer** - Handles all real-time client communication

---

### **6. `server/game-loop-engine.js` - Legacy Compatibility Layer**
**Purpose**: Backward compatibility wrapper that delegates to new architecture

**Key Responsibilities**:
- **API Compatibility**: Maintains old API for existing code
- **Delegation**: Routes all operations to new `GameEngine`
- **Memory Management**: Handles cleanup and statistics
- **Transition Support**: Provides smooth migration path

**Key Features**:
- **Zero Breaking Changes**: All existing code continues to work
- **Memory Cleanup**: Automatic cleanup every 2 minutes
- **Statistics**: Provides memory and performance stats
- **Gradual Migration**: Allows gradual transition to new architecture

**Architecture Role**: **Compatibility Layer** - Ensures smooth migration from old to new system

---

### **7. `server/database-service.js` - Database Operations**
**Purpose**: Centralized database operations and Supabase integration

**Key Responsibilities**:
- **Connection Management**: Manages Supabase client connections
- **User Operations**: Handles user balance, transactions, and profiles
- **Authentication**: Validates JWT tokens
- **Error Handling**: Provides consistent error handling for database operations

**Key Methods**:
- `getUserBalance(userId)` - Get user's GC balance
- `updateBalance(userId, amount, type)` - Update user balance
- `getUserTransactions(userId)` - Get user transaction history
- `validateToken(token)` - Validate JWT authentication
- `getUserProfile(userId)` - Get user profile data

**Architecture Role**: **Data Layer** - Handles all database interactions

---

### **8. `services/session-manager.js` - User Session Management**
**Purpose**: Manages user sessions, reconnections, and session state

**Key Responsibilities**:
- **Session Creation**: Creates and manages user sessions
- **Reconnection Handling**: Handles user reconnections gracefully
- **Session Timeouts**: Manages session expiration and cleanup
- **Connection Tracking**: Tracks WebSocket connections per session
- **Statistics**: Provides session statistics and monitoring

**Key Features**:
- **30-Minute Sessions**: Automatic session timeout
- **Reconnection Support**: Users can reconnect to existing sessions
- **Connection Tracking**: Multiple connections per session supported
- **Cleanup Timers**: Automatic cleanup of expired sessions

**Architecture Role**: **Session Layer** - Manages user sessions and connections

---

### **9. `services/chat-manager.js` - Chat System Management**
**Purpose**: Handles chat functionality and message management

**Key Responsibilities**:
- **Message Processing**: Handles chat message validation and processing
- **Room Management**: Manages chat rooms per game
- **Moderation**: Handles message filtering and moderation
- **Broadcasting**: Sends messages to appropriate users
- **Rate Limiting**: Prevents chat spam

**Architecture Role**: **Communication Service** - Handles chat functionality

---

### **10. `server/core/config-manager.js` - Configuration Management**
**Purpose**: Centralized configuration management and caching

**Key Responsibilities**:
- **Config Loading**: Loads game configurations from database
- **Caching**: Caches frequently accessed configurations
- **Validation**: Validates configuration changes
- **Reloading**: Periodic configuration reloading (5-minute cycles)

**Key Features**:
- **5-Minute Cache**: Reduces database calls
- **Smart Reloading**: Only reloads when needed
- **Validation**: Ensures configuration integrity
- **Game-Specific Configs**: Handles different configs per game type

**Architecture Role**: **Configuration Layer** - Manages all system configuration

---

### **11. `server/core/memory-manager.js` - Memory Management**
**Purpose**: Handles memory cleanup and optimization

**Key Responsibilities**:
- **Memory Monitoring**: Tracks memory usage
- **Garbage Collection**: Forces GC when needed
- **Cleanup Scheduling**: Schedules periodic cleanup
- **Leak Prevention**: Prevents memory leaks

**Architecture Role**: **Performance Layer** - Ensures optimal memory usage

---

### **12. `server/core/event-bus.js` - Event System**
**Purpose**: Inter-component communication system

**Key Responsibilities**:
- **Event Emission**: Allows components to emit events
- **Event Handling**: Routes events to appropriate handlers
- **Async Processing**: Handles events asynchronously
- **Error Handling**: Provides error handling for events

**Architecture Role**: **Communication Layer** - Enables loose coupling between components

---

## 🔄 Data Flow Architecture

### **1. Client Request Flow**
```
Client WebSocket → WebSocket Server → Game Engine → Specific Game → Database
```

### **2. Game State Flow**
```
Game Loop → Game State Update → Event Bus → WebSocket Server → Client
```

### **3. Bet Processing Flow**
```
Client Bet → WebSocket Server → Game Engine → Game Validation → Database → Response
```

### **4. Auto-Cashout Flow**
```
Game Loop → Auto-Cashout Check → Database Function → Event Emission → Client Notification
```

## 🎯 Key Design Patterns

### **1. Template Method Pattern**
- `BaseGame` defines the algorithm structure
- Subclasses implement specific steps
- Ensures consistent game behavior

### **2. Strategy Pattern**
- `GameEngine` uses different game strategies
- Games are interchangeable
- Easy to add new game types

### **3. Observer Pattern**
- `EventBus` allows loose coupling
- Components can subscribe to events
- Decoupled communication

### **4. Factory Pattern**
- `GameEngine` creates game instances
- Centralized game creation
- Consistent initialization

## 🚀 Adding New Games

### **Step 1: Create Game Class**
```javascript
// server/games/blackjack-game.js
const BaseGame = require('./base-game');

class BlackjackGame extends BaseGame {
  getGameType() {
    return 'blackjack';
  }
  
  async onInitialize() {
    // Blackjack-specific initialization
  }
  
  async onGameLoop() {
    // Blackjack game loop logic
  }
  
  // ... implement other required methods
}

module.exports = BlackjackGame;
```

### **Step 2: Register Game**
```javascript
// In server/core/game-engine.js
const BlackjackGame = require('../games/blackjack-game');

registerGameTypes() {
  this.gameRegistry.set('crash', CrashGame);
  this.gameRegistry.set('blackjack', BlackjackGame); // Add this
}
```

### **Step 3: Initialize Game**
```javascript
// In server/core/game-engine.js
async initializeDefaultGames() {
  await this.initializeGame('crash', 'crash-main');
  await this.initializeGame('blackjack', 'blackjack-main'); // Add this
}
```

### **Step 4: Add Configuration**
```javascript
// In config/game-config.js
getBetLimits('blackjack') {
  return { min: 5, max: 500 };
}
```

## 📊 Performance Characteristics

### **Memory Management**
- **Automatic Cleanup**: Every 2 minutes
- **Garbage Collection**: When heap > 100MB
- **Session Cleanup**: After 30 minutes
- **Connection Cleanup**: After 5 minutes of inactivity

### **Real-Time Performance**
- **Game Loop**: 60 FPS (16ms intervals)
- **Auto-Cashout**: Every 8ms for crash game
- **WebSocket Updates**: Every 1 second for crash state
- **Config Reload**: Every 5 minutes

### **Scalability Features**
- **Modular Design**: Easy to add new games
- **Memory Efficient**: Automatic cleanup prevents leaks
- **Event-Driven**: Loose coupling enables scaling
- **Database Optimization**: Caching reduces DB calls

## 🔍 Monitoring & Debugging

### **Health Check Endpoint**
```bash
GET /health
```
Returns system status, uptime, and architecture info.

### **Memory Statistics**
```javascript
const stats = gameEngine.getMemoryStats();
console.log(stats);
```

### **Game State Monitoring**
```javascript
const gameState = await gameEngine.getGameState('crash-main');
console.log(gameState);
```

## 🎯 Benefits of This Architecture

### **✅ Maintainability**
- Clear separation of concerns
- Modular design
- Consistent patterns across games
- Easy to understand and modify

### **✅ Scalability**
- Easy to add new games
- Independent game instances
- Efficient memory management
- Event-driven communication

### **✅ Reliability**
- Comprehensive error handling
- Automatic cleanup
- Graceful degradation
- Robust session management

### **✅ Performance**
- Optimized game loops
- Memory leak prevention
- Efficient database operations
- Real-time communication

### **✅ Developer Experience**
- Clear documentation
- Template for new games
- Consistent API
- Easy testing

## 🔮 Future Enhancements

### **Planned Features**
- **Redis Integration**: For session management
- **Microservices**: For extreme scaling
- **GraphQL API**: For flexible data queries
- **Real-Time Analytics**: Dashboard
- **A/B Testing**: Framework for game variants

### **Game Types Ready for Implementation**
- **Blackjack**: Card-based game with dealer
- **Roulette**: Wheel-based betting game
- **Slots**: Reel-based slot machine
- **Dice**: Simple dice rolling game
- **Hi-Lo**: Card guessing game

This architecture provides a **robust, scalable, and maintainable** foundation for the MineCash gaming platform, with clear patterns for adding new games and features. 
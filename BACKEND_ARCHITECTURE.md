# MineCash Backend Architecture Documentation

## 🏗️ Overview

The MineCash backend is a real-time WebSocket-based casino system built with Node.js, featuring modular architecture for easy expansion across multiple casino games. The system handles user authentication, real-time game interactions, chat functionality, and balance management.

## 🛠️ Tech Stack

### Core Technologies
- **Runtime**: Node.js (v18+)
- **WebSocket**: `ws` library for real-time communication
- **Database**: Supabase (PostgreSQL) with real-time subscriptions
- **Authentication**: Discord OAuth2 via Supabase Auth
- **File Storage**: Supabase Storage for assets
- **Environment**: Dotenv for configuration management

### Key Dependencies
```json
{
  "ws": "^8.14.2",
  "@supabase/supabase-js": "^2.38.0",
  "dotenv": "^16.3.1",
  "express": "^4.18.2"
}
```

## 🏛️ Architecture Overview

### Core Components

```
backend/
├── server/
│   ├── websocket-server.js    # Main WebSocket server
│   ├── room-manager.js        # Room & user management
│   └── database-service.js    # Database operations
├── services/
│   ├── chat-manager.js        # Real-time chat system
│   ├── session-manager.js     # User session management
│   └── balance-service.js     # Balance operations
├── config/
│   ├── env-manager.js         # Environment configuration
│   └── game-config.js         # Game settings
└── api/
    └── api-routes.js          # REST API endpoints
```

## 🔧 Core Architecture

### 1. WebSocket Server (`websocket-server.js`)
**Purpose**: Central real-time communication hub

**Key Features**:
- Handles all WebSocket connections
- Routes messages to appropriate managers
- Manages game engine integration
- Broadcasts game state updates

**Message Types**:
- `join_game` - User joins a gamemode
- `place_bet` - User places a bet
- `game_action` - User performs game action
- `chat_message` - Live chat messages
- `leave_game` - User leaves gamemode

### 2. Room Manager (`room-manager.js`)
**Purpose**: Manage gamemode-specific rooms and user connections

**Key Features**:
- Room creation and destruction
- User session tracking
- Cross-gamemode user management
- Connection state management

**Data Structures**:
```javascript
this.rooms = new Map(); // gamemode -> Set of WebSocket connections
this.connections = new Map(); // WebSocket -> user data
```

### 3. Chat Manager (`chat-manager.js`)
**Purpose**: Handle real-time chat functionality

**Key Features**:
- Cross-gamemode chat broadcasting
- Message validation and moderation
- Rate limiting (1 message/second)
- Database persistence
- Chat history loading

**Chat Flow**:
1. Message validation (length, content, rate limit)
2. Immediate broadcast to all casino rooms
3. Asynchronous database save
4. Real-time display in all gamemodes

### 4. Session Manager (`session-manager.js`)
**Purpose**: Manage user sessions and reconnection logic

**Key Features**:
- Session creation and cleanup
- Reconnection handling
- Session timeout management
- Activity tracking

## 🎮 Game Engine Integration

### Current Implementation (Crash Game)
The crash game demonstrates the complete game engine pattern:

```javascript
// Game state management
class CrashGameEngine {
  constructor() {
    this.gameState = 'waiting';
    this.crashPoint = 1.0;
    this.bets = new Map();
    this.history = [];
  }
  
  // Process user bet
  async processBet(gamemode, userId, betData) {
    // Validate bet
    // Update user balance
    // Store bet data
    // Return result
  }
  
  // Get current game state
  getCrashGameState(userId) {
    // Return personalized game state
    // Include user's bet information
    // Include crash history
  }
}
```

### Adding New Games

To add a new game (e.g., Blackjack, Roulette, Slots):

#### 1. Create Game Engine
```javascript
// backend/games/blackjack-engine.js
class BlackjackGameEngine {
  constructor() {
    this.gameState = 'waiting';
    this.deck = [];
    this.playerHands = new Map();
    this.dealerHand = [];
  }
  
  async processBet(gamemode, userId, betData) {
    // Blackjack-specific bet logic
  }
  
  getBlackjackGameState(userId) {
    // Return blackjack game state
  }
  
  handleGameAction(userId, action) {
    // Handle hit, stand, double, etc.
  }
}
```

#### 2. Add WebSocket Message Handlers
```javascript
// In websocket-server.js
case 'blackjack_action':
  if (this.gameEngine && this.gameEngine.handleBlackjackAction) {
    const result = await this.gameEngine.handleBlackjackAction(
      connection.userData.id, 
      payload.action
    );
    // Broadcast result
  }
  break;
```

#### 3. Update Frontend Integration
```javascript
// In frontend game component
websocketService.sendGameAction('hit', { gameId: 'blackjack-123' });
```

## 🔐 Security & Validation

### Authentication Flow
1. **Discord OAuth2** → Supabase Auth
2. **JWT Token** → WebSocket connection
3. **Token Validation** → Room access
4. **Session Management** → Reconnection handling

### Rate Limiting
- **Chat**: 1 message per second per user
- **Bets**: Configurable per gamemode
- **Actions**: Per-game rate limiting

### Input Validation
- Message length limits (300 chars)
- Bet amount validation
- Game action validation
- Content moderation

## 📊 Database Schema

### Core Tables
```sql
-- Users table (Supabase Auth)
users (
  id bigint primary key,
  auth_user_id uuid references auth.users,
  username text,
  avatar_url text,
  discord_id text,
  balance numeric default 0,
  created_at timestamp
);

-- Chat messages
chat_messages (
  id bigint primary key,
  user_id bigint references users(id),
  username text,
  avatar_url text,
  message text,
  gamemode text,
  created_at timestamp
);

-- Game transactions
game_transactions (
  id bigint primary key,
  user_id bigint references users(id),
  game_type text,
  bet_amount numeric,
  win_amount numeric,
  game_data jsonb,
  created_at timestamp
);
```

## 🚀 Deployment Guide

### Local Development
```bash
# Install dependencies
cd backend
npm install

# Set up environment variables
cp .env.example .env
# Edit .env with your Supabase credentials

# Start development server
npm start
```

### Production Deployment

#### Option 1: VPS/Cloud Server
```bash
# Install Node.js and PM2
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs
sudo npm install -g pm2

# Clone and setup
git clone <repository>
cd MineCash/backend
npm install
pm2 start server/index.js --name "minecash-backend"
pm2 save
pm2 startup
```

#### Option 2: Docker Deployment
```dockerfile
# Dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 8080
CMD ["node", "server/index.js"]
```

```bash
# Build and run
docker build -t minecash-backend .
docker run -p 8080:8080 --env-file .env minecash-backend
```

#### Option 3: Railway/Render/Vercel
- Connect GitHub repository
- Set environment variables
- Deploy automatically on push

### Environment Variables
```env
# Supabase Configuration
SUPABASE_URL=your_supabase_url
SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_KEY=your_service_key

# Discord OAuth2
DISCORD_CLIENT_ID=your_discord_client_id
DISCORD_CLIENT_SECRET=your_discord_client_secret

# Server Configuration
PORT=8080
NODE_ENV=production
```

## 🔧 Configuration

### Game Settings (`config/game-config.js`)
```javascript
module.exports = {
  crash: {
    minBet: 1,
    maxBet: 1000,
    houseEdge: 0.01,
    gameDuration: 30000
  },
  blackjack: {
    minBet: 5,
    maxBet: 500,
    houseEdge: 0.02,
    deckCount: 6
  },
  roulette: {
    minBet: 1,
    maxBet: 100,
    houseEdge: 0.027,
    wheelType: 'european'
  }
};
```

### Environment Management (`config/env-manager.js`)
```javascript
class EnvManager {
  getDatabaseConfig() {
    return {
      url: process.env.SUPABASE_URL,
      anonKey: process.env.SUPABASE_ANON_KEY,
      serviceKey: process.env.SUPABASE_SERVICE_KEY
    };
  }
}
```

## 📈 Monitoring & Logging

### Logging Strategy
```javascript
// Structured logging
console.log('user bet placed:', {
  userId: userData.id,
  gamemode: 'crash',
  amount: betAmount,
  timestamp: new Date().toISOString()
});
```

### Health Checks
```javascript
// Add to api-routes.js
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});
```

## 🔄 Scaling Considerations

### Horizontal Scaling
- **Load Balancer**: Distribute WebSocket connections
- **Redis**: Shared session storage
- **Database**: Supabase handles scaling automatically
- **CDN**: Static assets and game resources

### Performance Optimization
- **Connection Pooling**: Reuse database connections
- **Message Batching**: Batch similar messages
- **Caching**: Cache frequently accessed data
- **Compression**: Compress WebSocket messages

## 🧪 Testing Strategy

### Unit Tests
```javascript
// tests/chat-manager.test.js
describe('ChatManager', () => {
  test('should validate message length', () => {
    const result = chatManager.validateMessage('a'.repeat(301));
    expect(result.valid).toBe(false);
  });
});
```

### Integration Tests
```javascript
// tests/websocket-integration.test.js
describe('WebSocket Integration', () => {
  test('should handle chat message', async () => {
    // Test complete chat flow
  });
});
```

## 🚨 Troubleshooting

### Common Issues

#### WebSocket Connection Failed
```bash
# Check if server is running
curl http://localhost:8080/health

# Check environment variables
echo $SUPABASE_URL
```

#### Chat Messages Not Appearing
```javascript
// Check broadcast function
console.log('broadcasting to room:', gamemode, message);
```

#### Database Connection Issues
```javascript
// Test Supabase connection
const { data, error } = await supabase.from('users').select('count');
console.log('db connection:', error || 'success');
```

## 📚 API Reference

### WebSocket Events

#### Client → Server
```javascript
// Join game
{
  type: 'join_game',
  gamemode: 'crash',
  token: 'jwt_token'
}

// Place bet
{
  type: 'place_bet',
  amount: 100,
  gameId: 'crash-123'
}

// Send chat message
{
  type: 'chat_message',
  message: 'Hello world!',
  gamemode: 'crash'
}
```

#### Server → Client
```javascript
// Game state update
{
  type: 'crash_state_update',
  state: { crashPoint: 1.5, timeLeft: 10000 },
  history: [...]
}

// Chat message
{
  type: 'chat_message',
  id: '1234567890-123456',
  username: 'PlayerName',
  avatar: 'https://...',
  message: 'Hello world!',
  gamemode: 'crash',
  timestamp: 1234567890
}
```

## 🎯 Future Enhancements

### Planned Features
- **Multiplayer Games**: Real-time multiplayer blackjack, poker
- **Tournaments**: Scheduled tournaments with prizes
- **Achievements**: User achievement system
- **Leaderboards**: Global and gamemode-specific rankings
- **Analytics**: Advanced game analytics and reporting

### Technical Improvements
- **Microservices**: Split into separate services
- **GraphQL**: Add GraphQL API layer
- **WebRTC**: Real-time voice chat
- **Machine Learning**: Cheat detection and game optimization

---

## 📞 Support

For questions or issues:
1. Check the troubleshooting section
2. Review the API reference
3. Check Supabase dashboard for database issues
4. Monitor server logs for errors

**Documentation Version**: 1.0  
**Last Updated**: December 2024  
**Maintained By**: MineCash Development Team 
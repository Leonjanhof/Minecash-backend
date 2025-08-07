// Event Bus - Inter-game communication and system events
// Purpose: Handle communication between games and system components

class EventBus {
  constructor() {
    this.listeners = new Map(); // eventType -> array of listeners
    this.gameEvents = new Map(); // gameId -> game-specific events
    this.systemEvents = new Set(); // system-wide events
  }

  initialize() {
    console.log('event bus initialized');
  }

  // Subscribe to an event
  subscribe(eventType, listener, gameId = null) {
    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, []);
    }
    
    const listenerInfo = {
      listener,
      gameId,
      id: Date.now() + Math.random() // Unique ID for unsubscribing
    };
    
    this.listeners.get(eventType).push(listenerInfo);
    
    return listenerInfo.id; // Return ID for unsubscribing
  }

  // Unsubscribe from an event
  unsubscribe(eventType, listenerId) {
    if (!this.listeners.has(eventType)) {
      return false;
    }
    
    const listeners = this.listeners.get(eventType);
    const index = listeners.findIndex(l => l.id === listenerId);
    
    if (index !== -1) {
      listeners.splice(index, 1);
      return true;
    }
    
    return false;
  }

  // Emit an event
  async emit(eventType, data, gameId = null) {
    if (!this.listeners.has(eventType)) {
      return;
    }
    
    const listeners = this.listeners.get(eventType);
    const promises = [];
    
    for (const listenerInfo of listeners) {
      // If gameId is specified, only notify listeners for that game or system listeners
      if (gameId && listenerInfo.gameId && listenerInfo.gameId !== gameId) {
        continue;
      }
      
      try {
        const promise = listenerInfo.listener(data, eventType, gameId);
        if (promise && typeof promise.then === 'function') {
          promises.push(promise);
        }
      } catch (error) {
        console.error('error in event listener:', error);
      }
    }
    
    // Wait for all async listeners to complete
    if (promises.length > 0) {
      await Promise.allSettled(promises);
    }
  }

  // Game-specific events
  emitGameEvent(gameId, eventType, data) {
    return this.emit(eventType, data, gameId);
  }

  // System-wide events
  emitSystemEvent(eventType, data) {
    return this.emit(eventType, data);
  }

  // Subscribe to game-specific events
  subscribeToGame(gameId, eventType, listener) {
    return this.subscribe(eventType, listener, gameId);
  }

  // Subscribe to system events
  subscribeToSystem(eventType, listener) {
    return this.subscribe(eventType, listener);
  }

  // Common game events
  async emitGameStarted(gameId, gameData) {
    return this.emitGameEvent(gameId, 'game_started', gameData);
  }

  async emitGameEnded(gameId, gameData) {
    return this.emitGameEvent(gameId, 'game_ended', gameData);
  }

  async emitBetPlaced(gameId, betData) {
    return this.emitGameEvent(gameId, 'bet_placed', betData);
  }

  async emitCashout(gameId, cashoutData) {
    return this.emitGameEvent(gameId, 'cashout', cashoutData);
  }

  async emitRoundCompleted(gameId, roundData) {
    return this.emitGameEvent(gameId, 'round_completed', roundData);
  }

  // System events
  async emitUserConnected(userId, userData) {
    return this.emitSystemEvent('user_connected', { userId, ...userData });
  }

  async emitUserDisconnected(userId) {
    return this.emitSystemEvent('user_disconnected', { userId });
  }

  async emitConfigUpdated(configData) {
    return this.emitSystemEvent('config_updated', configData);
  }

  async emitMemoryWarning(memoryData) {
    return this.emitSystemEvent('memory_warning', memoryData);
  }

  // Get event statistics
  getStats() {
    return {
      totalListeners: Array.from(this.listeners.values()).reduce((sum, listeners) => sum + listeners.length, 0),
      eventTypes: Array.from(this.listeners.keys()),
      gameEvents: this.gameEvents.size,
      systemEvents: this.systemEvents.size
    };
  }

  // Cleanup method
  cleanup() {
    this.listeners.clear();
    this.gameEvents.clear();
    this.systemEvents.clear();
    console.log('event bus cleanup completed');
  }
}

module.exports = EventBus; 
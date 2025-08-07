// Memory Manager - Memory cleanup and optimization
// Purpose: Handle memory management, cleanup, and performance monitoring

class MemoryManager {
  constructor() {
    this.cleanupInterval = null;
    this.userLastMessageTime = new Map(); // userId -> last message timestamp
    this.gameStates = new Map(); // gameId -> state
    this.activeGames = new Set();
    this.cleanupStats = {
      lastCleanup: Date.now(),
      totalCleanups: 0,
      memoryFreed: 0
    };
  }

  initialize() {
    // Start periodic cleanup to prevent memory leaks
    this.startCleanupInterval();
    console.log('memory manager initialized');
  }

  // Start periodic cleanup interval
  startCleanupInterval() {
    // Clear any existing interval
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    
    // Run cleanup every 2 minutes to prevent memory buildup
    this.cleanupInterval = setInterval(() => {
      this.performMemoryCleanup();
    }, 2 * 60 * 1000);
  }

  // Perform memory cleanup
  performMemoryCleanup() {
    try {
      const now = Date.now();
      const oneHourAgo = now - (60 * 60 * 1000); // 1 hour
      
      // Clean up old user message times (older than 1 hour)
      let cleanedUsers = 0;
      for (const [userId, timestamp] of this.userLastMessageTime.entries()) {
        if (timestamp < oneHourAgo) {
          this.userLastMessageTime.delete(userId);
          cleanedUsers++;
        }
      }
      
      // Clean up completed games older than 30 minutes
      const thirtyMinutesAgo = now - (30 * 60 * 1000);
      let cleanedGames = 0;
      for (const [gameId, gameState] of this.gameStates.entries()) {
        if (gameState.phase === 'results' && gameState.endTime && gameState.endTime.getTime() < thirtyMinutesAgo) {
          this.gameStates.delete(gameId);
          this.activeGames.delete(gameId);
          cleanedGames++;
        }
      }
      
      // Force garbage collection if memory usage is high
      const memUsage = process.memoryUsage();
      const heapUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);
      
      // If heap usage is over 100MB, force garbage collection
      if (heapUsedMB > 100) {
        if (global.gc) {
          global.gc();
          console.log(`forced garbage collection at ${heapUsedMB}MB heap usage`);
        }
      }
      
      // Update cleanup stats
      this.cleanupStats.lastCleanup = now;
      this.cleanupStats.totalCleanups++;
      this.cleanupStats.memoryFreed += cleanedUsers + cleanedGames;
      
      // Log cleanup stats and memory usage
      if (this.userLastMessageTime.size > 1000 || this.gameStates.size > 50) {
        console.log(`memory cleanup completed - userLastMessageTime: ${this.userLastMessageTime.size}, gameStates: ${this.gameStates.size}, heapUsed: ${heapUsedMB}MB`);
      }
    } catch (error) {
      console.error('error during memory cleanup:', error);
    }
  }

  // Add user message time tracking
  trackUserMessage(userId) {
    this.userLastMessageTime.set(userId, Date.now());
  }

  // Add game state tracking
  trackGameState(gameId, state) {
    this.gameStates.set(gameId, state);
  }

  // Remove game state tracking
  untrackGameState(gameId) {
    this.gameStates.delete(gameId);
    this.activeGames.delete(gameId);
  }

  // Get memory statistics
  getStats() {
    const memUsage = process.memoryUsage();
    
    return {
      // Node.js memory statistics
      memory: {
        heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024), // MB
        heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024), // MB
        external: Math.round(memUsage.external / 1024 / 1024), // MB
        rss: Math.round(memUsage.rss / 1024 / 1024), // MB
        heapUsage: Math.round((memUsage.heapUsed / memUsage.heapTotal) * 100), // Percentage
        memoryEfficiency: Math.round((memUsage.heapUsed / memUsage.rss) * 100) // Percentage
      },
      // Tracking statistics
      tracking: {
        userConnections: this.userLastMessageTime.size,
        gameStates: this.gameStates.size,
        activeGames: this.activeGames.size
      },
      // Cleanup statistics
      cleanup: this.cleanupStats
    };
  }

  // Cleanup method
  cleanup() {
    // Clear cleanup interval
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    
    // Clear all maps and sets to free memory
    this.userLastMessageTime.clear();
    this.gameStates.clear();
    this.activeGames.clear();
    
    // Force garbage collection if available
    if (global.gc) {
      global.gc();
    }
    
    console.log('memory manager cleanup completed');
  }
}

module.exports = MemoryManager; 
// Base Game - Abstract base class for all game implementations
// Purpose: Define common interface and functionality for all games

class BaseGame {
  constructor(gameId, config, services) {
    this.gameId = gameId;
    this.config = config;
    this.services = services;
    
    // Services
    this.databaseService = services.databaseService;
    this.logger = services.logger;
    this.eventBus = services.eventBus;
    this.configManager = services.configManager;
    
    // Game state
    this.state = {
      phase: 'waiting', // waiting, betting, playing, results
      startTime: null,
      endTime: null,
      players: new Map(),
      bets: new Map()
    };
    
    // Game loop
    this.gameLoop = null;
    this.isRunning = false;
    
    // Validation
    this.validators = new Map();
    this.calculators = new Map();
  }

  async initialize() {
    try {
      // Initialize game-specific logic
      await this.onInitialize();
      
      // Start game loop
      this.startGameLoop();
      
      this.logger.info(`initialized ${this.getGameType()} game: ${this.gameId}`);
    } catch (error) {
      this.logger.error(`failed to initialize ${this.getGameType()} game`, { error: error.message });
      throw error;
    }
  }

  // Abstract methods that must be implemented by subclasses
  getGameType() {
    throw new Error('getGameType() must be implemented by subclass');
  }

  async onInitialize() {
    throw new Error('onInitialize() must be implemented by subclass');
  }

  async onGameLoop() {
    throw new Error('onGameLoop() must be implemented by subclass');
  }

  async onProcessBet(userId, betData) {
    throw new Error('onProcessBet() must be implemented by subclass');
  }

  async onProcessAction(userId, action, data) {
    throw new Error('onProcessAction() must be implemented by subclass');
  }

  // NEW: Generic cashout methods
  async onProcessCashout(userId, cashoutValue) {
    throw new Error('onProcessCashout() must be implemented by subclass');
  }

  async onProcessAutoCashout(userId, targetValue) {
    throw new Error('onProcessAutoCashout() must be implemented by subclass');
  }

  async onGetState(userId) {
    throw new Error('onGetState() must be implemented by subclass');
  }

  async onGetHistory(limit) {
    throw new Error('onGetHistory() must be implemented by subclass');
  }

  // Common game methods
  startGameLoop() {
    if (this.gameLoop) {
      clearInterval(this.gameLoop);
    }
    
    this.gameLoop = setInterval(async () => {
      try {
        await this.onGameLoop();
      } catch (error) {
        this.logger.error('error in game loop', { error: error.message });
      }
    }, 16); // 60 FPS
    
    this.isRunning = true;
  }

  stopGameLoop() {
    if (this.gameLoop) {
      clearInterval(this.gameLoop);
      this.gameLoop = null;
    }
    this.isRunning = false;
  }

  async processBet(userId, betData) {
    try {
      // Validate user ban status
      const banCheck = await this.checkUserBanStatus(userId);
      if (!banCheck.allowed) {
        return { 
          success: false, 
          message: banCheck.message 
        };
      }

      // Validate bet
      const validation = await this.validateBet(userId, betData);
      if (!validation.valid) {
        return { 
          success: false, 
          message: validation.message,
          ...validation.details
        };
      }

      // Process bet using game-specific logic
      const result = await this.onProcessBet(userId, betData);
      
      // Emit bet placed event
      if (result.success) {
        await this.eventBus.emitBetPlaced(this.gameId, {
          userId,
          betData,
          result
        });
      }

      return result;
    } catch (error) {
      this.logger.error('error processing bet', { error: error.message });
      return { 
        success: false, 
        message: 'Failed to process bet' 
      };
    }
  }

  async processAction(userId, action, data) {
    try {
      // Process action using game-specific logic
      const result = await this.onProcessAction(userId, action, data);
      
      // Emit appropriate events based on action
      if (result.success) {
        if (action === 'cashout') {
          await this.eventBus.emitCashout(this.gameId, {
            userId,
            action,
            data,
            result
          });
        }
      }

      return result;
    } catch (error) {
      this.logger.error('error processing game action', { error: error.message });
      return { 
        success: false, 
        message: 'Failed to process game action' 
      };
    }
  }

  // NEW: Generic cashout processing
  async processCashout(userId, cashoutValue) {
    try {
      // Validate cashout
      const validation = await this.validateCashout(userId, cashoutValue);
      if (!validation.valid) {
        return { 
          success: false, 
          message: validation.message 
        };
      }

      // Process cashout using game-specific logic
      const result = await this.onProcessCashout(userId, cashoutValue);
      
      // Emit cashout event
      if (result.success) {
        await this.eventBus.emitCashout(this.gameId, {
          userId,
          action: 'cashout',
          cashoutValue,
          result
        });
      }

      return result;
    } catch (error) {
      this.logger.error('error processing cashout', { error: error.message });
      return { 
        success: false, 
        message: 'Failed to process cashout' 
      };
    }
  }

  // NEW: Generic auto-cashout processing
  async processAutoCashout(userId, targetValue) {
    try {
      // Process auto-cashout using game-specific logic
      const result = await this.onProcessAutoCashout(userId, targetValue);
      
      // Emit auto-cashout event
      if (result.success) {
        await this.eventBus.emitAutoCashout(this.gameId, {
          userId,
          targetValue,
          result
        });
      }

      return result;
    } catch (error) {
      this.logger.error('error processing auto-cashout', { error: error.message });
      return { 
        success: false, 
        message: 'Failed to process auto-cashout' 
      };
    }
  }

  async getState(userId = null) {
    try {
      return await this.onGetState(userId);
    } catch (error) {
      this.logger.error('error getting game state', { error: error.message });
      return null;
    }
  }

  async getHistory(limit = 20) {
    try {
      return await this.onGetHistory(limit);
    } catch (error) {
      this.logger.error('error getting game history', { error: error.message });
      return [];
    }
  }

  // Validation methods
  async checkUserBanStatus(userId) {
    try {
      const { data: userData, error } = await this.databaseService.supabase
        .from('users')
        .select('banned')
        .eq('id', userId)
        .single();
      
      if (error) {
        this.logger.error('error checking user ban status', { error: error.message });
        return { allowed: false, message: 'Failed to verify user status' };
      }
      
      if (userData?.banned) {
        this.logger.warning(`banned user ${userId} attempted to place bet`);
        return { allowed: false, message: 'You are banned from placing bets' };
      }
      
      return { allowed: true };
    } catch (error) {
      this.logger.error('error checking ban status', { error: error.message });
      return { allowed: false, message: 'Failed to verify user status' };
    }
  }

  async validateBet(userId, betData) {
    const { amount, betType } = betData;
    
    // Check bet limits
    const betLimits = this.configManager.getBetLimits(this.getGameType());
    if (amount < betLimits.min || amount > betLimits.max) {
      return { 
        valid: false, 
        message: `bet amount must be between ${betLimits.min} and ${betLimits.max}`,
        details: {
          minBet: betLimits.min,
          maxBet: betLimits.max
        }
      };
    }
    
    return { valid: true };
  }

  // NEW: Generic cashout validation
  async validateCashout(userId, cashoutValue) {
    try {
      // Check if user has an active bet for this game
      const { data: userBet, error } = await this.databaseService.supabase
        .from('game_bets')
        .select('*')
        .eq('user_id', userId)
        .eq('game_type', this.getGameType())
        .eq('status', 'active')
        .single();
      
      if (error || !userBet) {
        return { valid: false, message: 'No active bet found to cashout' };
      }
      
      // Check if cashout value is reasonable
      if (cashoutValue < 1.0 || cashoutValue > 1000.0) {
        return { valid: false, message: 'Invalid cashout value' };
      }
      
      return { valid: true };
    } catch (error) {
      this.logger.error('error validating cashout', { error: error.message });
      return { valid: false, message: 'Failed to validate cashout' };
    }
  }

  // State management
  updateState(newState) {
    this.state = { ...this.state, ...newState };
  }

  getState() {
    return this.state;
  }

  // Event emission helpers
  async emitGameStarted(gameData) {
    await this.eventBus.emitGameStarted(this.gameId, gameData);
  }

  async emitGameEnded(gameData) {
    await this.eventBus.emitGameEnded(this.gameId, gameData);
  }

  async emitRoundCompleted(roundData) {
    await this.eventBus.emitRoundCompleted(this.gameId, roundData);
  }

  // Stop the game
  async stop() {
    try {
      this.stopGameLoop();
      await this.onStop();
      this.logger.info(`stopped ${this.getGameType()} game: ${this.gameId}`);
    } catch (error) {
      this.logger.error('error stopping game', { error: error.message });
    }
  }

  async onStop() {
    // Override in subclasses if needed
  }

  // Cleanup method
  cleanup() {
    this.stopGameLoop();
    this.state.players.clear();
    this.state.bets.clear();
  }
}

module.exports = BaseGame; 
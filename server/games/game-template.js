// Game Template - Template for implementing new games
// Purpose: Show how to implement a new game using the generic system

const BaseGame = require('./base-game');

class GameTemplate extends BaseGame {
  constructor(gameId, config, services) {
    super(gameId, config, services);
    
    // Game-specific state
    this.gameState = {
      phase: 'waiting', // waiting, betting, playing, results
      currentRoundId: null,
      currentValue: 1.00, // Game-specific value (multiplier, payout, etc.)
      phaseStartTime: Date.now(),
      resultPhaseStartTime: null,
      activePlayersCount: 0,
      totalBetAmount: 0.00,
      currentRoundNumber: 1,
      gameHash: null,
      serverSeed: null,
      clientSeed: null
    };
    
    // Game-specific flags
    this.lastRoundCompleted = null;
    this.isStartingNewRound = false;
    this.lastProcessedRound = null;
    this.lastAutoCashoutCheck = 0;
    this.lastConfigReload = Date.now();
    this.configReloadInterval = 300000; // 5 minutes
    this._hasStartedReloadCycle = false;
    
    // Auto-cashout cleanup scheduler (if needed)
    this.autoCashoutCleanupInterval = null;
  }

  getGameType() {
    return 'template'; // Change this to your game type
  }

  async onInitialize() {
    // TODO: Implement game-specific initialization
    // 1. Check for existing active round
    // 2. Create new round if needed
    // 3. Initialize game state
    // 4. Start any schedulers
    
    console.log('template game initialized');
  }

  async onGameLoop() {
    // TODO: Implement game-specific game loop
    // 1. Update game state
    // 2. Process auto-cashouts (if applicable)
    // 3. Check for game end conditions
    // 4. Start new rounds
    
    const timeElapsed = (Date.now() - this.gameState.phaseStartTime) / 1000.0;
    const gameTiming = this.configManager.getGameTiming();

    // Example game loop logic
    if (this.gameState.phase === 'betting') {
      // Start game after betting phase duration
      if (timeElapsed > (gameTiming.bettingPhase / 1000)) {
        await this.startGame();
      }
    } else if (this.gameState.phase === 'playing') {
      // Update game-specific value
      this.gameState.currentValue = this.calculateGameValue(timeElapsed);
      
      // Check for game end conditions
      if (this.shouldEndGame()) {
        await this.endGame();
      }
    } else if (this.gameState.phase === 'results') {
      // Start new round after result phase duration
      const resultPhaseDuration = gameTiming.resultPhase / 1000;
      const resultPhaseElapsed = this.gameState.resultPhaseStartTime 
        ? (Date.now() - this.gameState.resultPhaseStartTime) / 1000.0 
        : 0;
      
      if (resultPhaseElapsed > resultPhaseDuration && !this.isStartingNewRound) {
        this.isStartingNewRound = true;
        await this.startNewRound();
        this.isStartingNewRound = false;
      }
    }
  }

  async onProcessBet(userId, betData) {
    const { amount, betType } = betData;
    
    // Check if we're in betting phase
    if (this.gameState.phase !== 'betting') {
      return { 
        success: false, 
        message: 'betting is not currently open', 
        phase: this.gameState.phase 
      };
    }

    // Game config validation
    const gameConfig = this.configManager.getGameConfig(this.getGameType());
    if (gameConfig) {
      if (amount < gameConfig.minBet) {
        return { 
          success: false, 
          message: `minimum bet is ${gameConfig.minBet} GC` 
        };
      }
      if (amount > gameConfig.maxBet) {
        return { 
          success: false, 
          message: `maximum bet is ${gameConfig.maxBet} GC` 
        };
      }
    }
    
    // Check if user already has a bet for this round
    try {
      const { data: existingBet, error } = await this.databaseService.supabase
        .from('game_bets')
        .select('id')
        .eq('user_id', userId)
        .eq('game_type', this.getGameType())
        .eq('round_id', this.gameState.currentRoundId)
        .single();
        
      if (!error && existingBet) {
        return { 
          success: false, 
          message: 'you already have a bet for this round' 
        };
      }
    } catch (error) {
      console.error('error checking existing bet:', error);
      return { 
        success: false, 
        message: 'failed to validate bet' 
      };
    }

    // Use generic place bet function
    try {
      const { data: result, error } = await this.databaseService.supabase.rpc('place_bet', {
        p_game_type: this.getGameType(),
        p_user_id: userId,
        p_bet_amount: amount,
        p_round_id: this.gameState.currentRoundId
      });
    
      if (error) {
        console.error('error placing bet:', error);
        return { 
          success: false, 
          message: error.message || 'failed to place bet' 
        };
      }
      
      return { 
        success: true, 
        message: 'bet placed successfully',
        betAmount: amount,
        betId: result.bet_id,
        newBalance: result.new_balance,
        gameState: this.gameState
      };
      
    } catch (error) {
      console.error('failed to place bet:', error);
      return { 
        success: false, 
        message: 'failed to place bet' 
      };
    }
  }

  async onProcessAction(userId, action, data) {
    if (action === 'cashout') {
      // Check if we're in playing phase
      if (this.gameState.phase !== 'playing') {
        return { 
          success: false, 
          message: 'cashout is only available during the playing phase' 
        };
      }

      // Use the generic cashout method
      const cashoutValue = this.gameState.currentValue;
      return await this.onProcessCashout(userId, cashoutValue);
    }

    if (action === 'auto_cashout') {
      // Check if we're in betting or playing phase
      if (this.gameState.phase !== 'betting' && this.gameState.phase !== 'playing') {
        return { 
          success: false, 
          message: 'auto-cashout can only be set during betting or playing phase' 
        };
      }

      const targetValue = data?.targetValue;
      if (!targetValue || targetValue < 1.0) {
        return { 
          success: false, 
          message: 'invalid target value. must be at least 1.0x' 
        };
      }

      // Use the generic auto-cashout method
      return await this.onProcessAutoCashout(userId, targetValue);
    }

    return { 
      success: false, 
      message: `unknown action: ${action}` 
    };
  }

  // Implement generic cashout method
  async onProcessCashout(userId, cashoutValue) {
    try {
      // Check if user has an active bet
      const { data: userBet, error: betError } = await this.databaseService.supabase
        .from('game_bets')
        .select('*')
        .eq('user_id', userId)
        .eq('game_type', this.getGameType())
        .eq('round_id', this.gameState.currentRoundId)
        .eq('status', 'active')
        .single();

      if (betError || !userBet) {
        return { 
          success: false, 
          message: 'no active bet found to cashout' 
        };
      }

      // Use the generic cashout function
      const { data: result, error: cashoutError } = await this.databaseService.supabase.rpc('cashout_bet', {
        p_game_type: this.getGameType(),
        p_user_id: userId,
        p_round_id: this.gameState.currentRoundId,
        p_cashout_value: cashoutValue
      });

      if (cashoutError) {
        console.error('error processing cashout:', cashoutError);
        return { 
          success: false, 
          message: cashoutError.message || 'failed to process cashout' 
        };
      }

      return { 
        success: true, 
        message: 'cashout successful',
        cashoutAmount: result.payout_amount,
        cashoutValue: cashoutValue,
        newBalance: result.new_balance,
        betId: result.bet_id
      };
    } catch (error) {
      console.error('error in onProcessCashout:', error);
      return { 
        success: false, 
        message: 'failed to process cashout' 
      };
    }
  }

  // Implement generic auto-cashout method
  async onProcessAutoCashout(userId, targetValue) {
    try {
      // Check if user has an active bet
      const { data: userBet, error: betError } = await this.databaseService.supabase
        .from('game_bets')
        .select('*')
        .eq('user_id', userId)
        .eq('game_type', this.getGameType())
        .eq('round_id', this.gameState.currentRoundId)
        .eq('status', 'active')
        .single();

      if (betError || !userBet) {
        return { 
          success: false, 
          message: 'no active bet found to set auto-cashout for' 
        };
      }

      // Use the generic set auto-cashout function
      const { data: result, error: autoCashoutError } = await this.databaseService.supabase.rpc('set_auto_cashout', {
        p_game_type: this.getGameType(),
        p_user_id: userId,
        p_round_id: this.gameState.currentRoundId,
        p_target_value: targetValue
      });

      if (autoCashoutError) {
        console.error('error setting auto-cashout:', autoCashoutError);
        return { 
          success: false, 
          message: autoCashoutError.message || 'failed to set auto-cashout' 
        };
      }

      return { 
        success: true, 
        message: 'auto-cashout set successfully',
        targetValue: targetValue,
        result: result
      };
    } catch (error) {
      console.error('error in onProcessAutoCashout:', error);
      return { 
        success: false, 
        message: 'failed to set auto-cashout' 
      };
    }
  }

  async onGetState(userId = null) {
    const state = { ...this.gameState };
    
    // Add user-specific bet information if available
    if (userId && userId !== 'anonymous') {
      try {
        const { data: userBet, error } = await this.databaseService.supabase
          .from('game_bets')
          .select('*')
          .eq('user_id', userId)
          .eq('game_type', this.getGameType())
          .eq('round_id', this.gameState.currentRoundId)
          .single();
        
        if (!error && userBet) {
          state.userBet = {
            amount: userBet.bet_amount,
            betId: userBet.id,
            placedAt: userBet.created_at
          };
        }
      } catch (error) {
        console.error('error getting user bet:', error);
      }
    }
    
    return state;
  }

  async onGetHistory(limit = 20) {
    try {
      const { data: rounds, error } = await this.databaseService.supabase
        .from('game_rounds')
        .select('*')
        .eq('game_type', this.getGameType())
        .order('created_at', { ascending: false })
        .limit(limit);
      
      if (error) {
        console.error('error getting game history:', error);
        return [];
      }
      
      return rounds || [];
    } catch (error) {
      console.error('error getting game history:', error);
      return [];
    }
  }

  // Game-specific helper methods
  calculateGameValue(timeElapsed) {
    // TODO: Implement game-specific value calculation
    // This could be a multiplier, payout, or other game-specific value
    return 1.0 + (timeElapsed * 0.1);
  }

  shouldEndGame() {
    // TODO: Implement game-specific end conditions
    return this.gameState.currentValue >= 10.0; // Example: end at 10x
  }

  async startGame() {
    // TODO: Implement game-specific start logic
    this.gameState.phase = 'playing';
    this.gameState.phaseStartTime = Date.now();
    console.log('template game started');
  }

  async endGame() {
    // TODO: Implement game-specific end logic
    this.gameState.phase = 'results';
    this.gameState.resultPhaseStartTime = Date.now();
    console.log('template game ended');
  }

  async startNewRound() {
    // TODO: Implement game-specific new round logic
    this.gameState.phase = 'betting';
    this.gameState.phaseStartTime = Date.now();
    this.gameState.currentValue = 1.0;
    this.gameState.currentRoundNumber++;
    console.log('template new round started');
  }

  async onStop() {
    // Game-specific cleanup
    this.lastRoundCompleted = null;
    this.isStartingNewRound = false;
    this.lastProcessedRound = null;
    this.lastAutoCashoutCheck = 0;
  }

  cleanup() {
    super.cleanup();
    // Additional game-specific cleanup
    this.gameState = {
      phase: 'waiting',
      currentRoundId: null,
      currentValue: 1.00,
      phaseStartTime: Date.now(),
      resultPhaseStartTime: null,
      activePlayersCount: 0,
      totalBetAmount: 0.00,
      currentRoundNumber: 1,
      gameHash: null,
      serverSeed: null,
      clientSeed: null
    };
  }
}

module.exports = GameTemplate; 
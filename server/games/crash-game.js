// Crash Game - Crash game implementation
// Purpose: Handle crash game logic, state management, and database operations

const BaseGame = require('./base-game');

class CrashGame extends BaseGame {
  constructor(gameId, config, services) {
    super(gameId, config, services);
    
    // Crash-specific state
    this.crashState = {
      phase: 'waiting', // waiting, betting, playing, crashed
      currentRoundId: null,
      currentMultiplier: 1.00,
      phaseStartTime: Date.now(),
      resultPhaseStartTime: null,
      activePlayersCount: 0,
      totalBetAmount: 0.00,
      currentCrashPoint: 1.00,
      currentRoundNumber: 1,
      gameHash: null,
      serverSeed: null,
      clientSeed: null
    };
    
    // Crash-specific flags
    this.lastRoundCompleted = null;
    this.isStartingNewRound = false;
    this.lastProcessedRound = null;
    this.lastAutoCashoutCheck = 0;
    this.lastConfigReload = Date.now();
    this.configReloadInterval = 300000; // 5 minutes
    this._hasStartedReloadCycle = false;
    
    // Auto-cashout cleanup scheduler
    this.autoCashoutCleanupInterval = null;
  }

  getGameType() {
    return 'crash';
  }

  async onInitialize() {
    // Check if there's already an active round
    const { data: existingActiveRound, error: activeRoundError } = await this.databaseService.supabase
      .from('game_rounds')
      .select('id, round_number, game_data, status')
      .eq('game_type', 'crash')
      .eq('status', 'active')
      .order('id', { ascending: false })
      .limit(1)
      .single();
    
    if (!activeRoundError && existingActiveRound) {
      console.log(`found existing active round ${existingActiveRound.round_number}, using it instead of creating new one`);
      
      // Use the existing active round
      this.crashState.currentRoundId = existingActiveRound.id;
      this.crashState.currentRoundNumber = existingActiveRound.round_number;
      this.crashState.phase = existingActiveRound.game_data?.phase || 'betting';
      this.crashState.phaseStartTime = Date.now();
      this.crashState.currentCrashPoint = existingActiveRound.game_data?.crash_multiplier || 1.00;
      this.crashState.gameHash = existingActiveRound.game_data?.game_hash;
      this.crashState.serverSeed = existingActiveRound.game_data?.server_seed;
      this.crashState.clientSeed = existingActiveRound.game_data?.client_seed;
      
      console.log('using existing active round, not creating new one');
      return;
    }
    
    // Create new round if no active round exists
    const crypto = require('crypto');
    const serverSeed = crypto.randomBytes(32).toString('hex');
    const clientSeed = 'default';
    
    // Generate crash multiplier (this should match the old logic)
    const crashMultiplier = this.generateCrashMultiplier(serverSeed, clientSeed);
    
    // Create game data for the round
    const gameData = {
      phase: 'betting',
      crash_multiplier: crashMultiplier,
      game_hash: crypto.createHash('sha256').update(serverSeed + clientSeed).digest('hex'),
      server_seed: serverSeed,
      client_seed: clientSeed,
      current_multiplier: 1.00,
      active_players_count: 0,
      total_bet_amount: 0.00,
      phase_start_time: new Date().toISOString()
    };
    
    const { data: roundId, error: roundError } = await this.databaseService.supabase.rpc('create_game_round', {
      p_game_type: 'crash',
      p_game_data: gameData
    });
    
    if (roundError) {
      console.error('error creating initial crash round:', roundError);
      throw roundError;
    }
    
    this.crashState.currentRoundId = roundId;
    this.crashState.currentRoundNumber = 1; // Will be set by the function
    this.crashState.phase = 'betting';
    this.crashState.phaseStartTime = Date.now();
    this.crashState.currentCrashPoint = crashMultiplier;
    this.crashState.gameHash = gameData.game_hash;
    this.crashState.serverSeed = serverSeed;
    this.crashState.clientSeed = clientSeed;
    
    // Start auto-cashout cleanup scheduler
    this.startAutoCashoutCleanupScheduler();
  }

  // Helper method to generate crash multiplier (moved from database function)
  generateCrashMultiplier(serverSeed, clientSeed) {
    const crypto = require('crypto');
    const hash = crypto.createHash('sha256').update(serverSeed + clientSeed).digest('hex');
    const h = parseInt(hash.substring(0, 8), 16);
    const e = Math.pow(2, 52);
    const x = (h % e) / e;
    const result = (1 / (1 - x)) * 0.99;
    return Math.max(1.00, result);
  }

  async onGameLoop() {
    const timeElapsed = (Date.now() - this.crashState.phaseStartTime) / 1000.0;
    const gameTiming = this.configManager.getGameTiming();

    // Reload game config periodically
    const now = Date.now();
    if (!this.lastConfigReload || (now - this.lastConfigReload) > this.configReloadInterval) {
      try {
        await this.configManager.loadConfig();
        this.lastConfigReload = now;
        if (this._hasStartedReloadCycle) {
          console.log('Game configuration reloaded from database (5-minute cycle)');
        } else {
          this._hasStartedReloadCycle = true;
        }
      } catch (error) {
        // Silent error handling
      }
    }

    // Process auto-cashouts with high-frequency checks for accuracy
    if (this.crashState.phase === 'playing') {
      const now = Date.now();
      if (now - this.lastAutoCashoutCheck >= 8) {
        await this.processAutoCashouts();
        this.lastAutoCashoutCheck = now;
      }
    }

    if (this.crashState.phase === 'betting') {
      // Start game after betting phase duration
      if (timeElapsed > (gameTiming.bettingPhase / 1000)) {
        await this.startCrashGame();
      }
    } else if (this.crashState.phase === 'playing') {
      // Update multiplier with higher precision - FIXED: Remove toFixed(4) to prevent precision loss
      this.crashState.currentMultiplier = 1.0024 * Math.pow(1.0718, timeElapsed);
      
      // Update database state every 1 second
      if (Math.floor(timeElapsed) !== Math.floor((timeElapsed - 1))) {
        try {
          await this.databaseService.supabase
            .from('game_rounds')
            .update({
              game_data: this.databaseService.supabase.raw(`jsonb_set(game_data, '{current_multiplier}', '${this.crashState.currentMultiplier}')`),
              updated_at: new Date().toISOString()
            })
            .eq('id', this.crashState.currentRoundId);
        } catch (error) {
          console.error('error updating crash game state:', error);
        }
      }
      
      // Check if crashed
      const currentMultiplier = this.crashState.currentMultiplier;
      const crashPoint = parseFloat(this.crashState.currentCrashPoint);
      
      if (currentMultiplier >= crashPoint && 
          this.crashState.phase === 'playing' && 
          this.lastProcessedRound !== this.crashState.currentRoundId) {
        
        this.crashState.currentMultiplier = this.crashState.currentCrashPoint;
        
        // Update database with final crash value
        try {
          await this.databaseService.supabase
            .from('game_rounds')
            .update({
              game_data: this.databaseService.supabase.raw(`jsonb_set(game_data, '{current_multiplier}', '${this.crashState.currentCrashPoint}')`),
              updated_at: new Date().toISOString()
            })
            .eq('id', this.crashState.currentRoundId);
        } catch (error) {
          console.error('error updating final crash multiplier:', error);
        }
        
        // Broadcast final crash value
        if (global.serverInstance && global.serverInstance.wsServer) {
          global.serverInstance.wsServer.broadcastToRoom('crash', {
            type: 'crash_final_value',
            crashPoint: this.crashState.currentCrashPoint,
            roundNumber: this.crashState.currentRoundNumber,
            timestamp: new Date().toISOString()
          });
        }
        
        this.crashState.phase = 'crashed';
        this.crashState.resultPhaseStartTime = Date.now();
        await this.handleCrashGame();
      }
    } else if (this.crashState.phase === 'crashed') {
      // Start new round after result phase duration
      const resultPhaseDuration = gameTiming.resultPhase / 1000;
      const resultPhaseElapsed = this.crashState.resultPhaseStartTime 
        ? (Date.now() - this.crashState.resultPhaseStartTime) / 1000.0 
        : 0;
      
      if (resultPhaseElapsed > resultPhaseDuration && !this.isStartingNewRound) {
        this.isStartingNewRound = true;
        await this.startNewCrashRound();
        this.isStartingNewRound = false;
      }
    }
  }

  async onProcessBet(userId, betData) {
    const { amount, betType } = betData;
    
    // Check if we're in betting phase
    if (this.crashState.phase !== 'betting') {
      return { 
        success: false, 
        message: 'betting is not currently open', 
        phase: this.crashState.phase 
      };
    }

    // GAME CONFIG VALIDATION: Check bet limits from config
    const gameConfig = this.configManager.getGameConfig('crash');
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
        .eq('game_type', 'crash')
        .eq('round_id', this.crashState.currentRoundId)
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

    // Use database function to place bet (we'll need to create a generic place_bet function)
    try {
      const { data: result, error } = await this.databaseService.supabase.rpc('place_bet', {
        p_game_type: 'crash',
        p_user_id: userId,
        p_bet_amount: amount,
        p_round_id: this.crashState.currentRoundId
      });
    
      if (error) {
        console.error('error placing crash bet:', error);
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
        gameState: this.crashState
      };
      
    } catch (error) {
      console.error('failed to place crash bet:', error);
      return { 
        success: false, 
        message: 'failed to place bet' 
      };
    }
  }

  async onProcessAction(userId, action, data) {
    if (action === 'cashout') {
      // Check if we're in playing phase
      if (this.crashState.phase !== 'playing') {
        return { 
          success: false, 
          message: 'cashout is only available during the playing phase' 
        };
      }

      // Use the new generic cashout method
      const cashoutValue = this.crashState.currentMultiplier;
      return await this.onProcessCashout(userId, cashoutValue);
    }

    if (action === 'auto_cashout') {
      // Check if we're in betting or playing phase
      if (this.crashState.phase !== 'betting' && this.crashState.phase !== 'playing') {
        return { 
          success: false, 
          message: 'auto-cashout can only be set during betting or playing phase' 
        };
      }

      const targetValue = data?.targetMultiplier;
      if (!targetValue || targetValue < 1.0) {
        return { 
          success: false, 
          message: 'invalid target multiplier. must be at least 1.0x' 
        };
      }

      // Use the new generic auto-cashout method
      return await this.onProcessAutoCashout(userId, targetValue);
    }

    return { 
      success: false, 
      message: `unknown action: ${action}` 
    };
  }

  // NEW: Implement generic cashout method
  async onProcessCashout(userId, cashoutValue) {
    try {
      // Check if user has an active bet
      const { data: userBet, error: betError } = await this.databaseService.supabase
        .from('game_bets')
        .select('*')
        .eq('user_id', userId)
        .eq('game_type', 'crash')
        .eq('round_id', this.crashState.currentRoundId)
        .eq('status', 'active')
        .single();

      if (betError || !userBet) {
        return { 
          success: false, 
          message: 'no active bet found to cashout' 
        };
      }

      // Use the new generic cashout function
      const { data: result, error: cashoutError } = await this.databaseService.supabase.rpc('cashout_bet', {
        p_game_type: 'crash',
        p_user_id: userId,
        p_round_id: this.crashState.currentRoundId,
        p_cashout_value: cashoutValue
      });

      if (cashoutError) {
        console.error('error processing cashout:', cashoutError);
        return { 
          success: false, 
          message: cashoutError.message || 'failed to process cashout' 
        };
      }

      // PRECISION SAFEGUARD: Verify payout amount is correct
      const expectedPayout = userBet.bet_amount * cashoutValue;
      const actualPayout = result.payout_amount;
      
      // Allow for small floating point precision differences (0.01 GC tolerance)
      if (Math.abs(actualPayout - expectedPayout) > 0.01) {
        console.error('CRITICAL: Payout amount mismatch', {
          expected: expectedPayout,
          actual: actualPayout,
          difference: Math.abs(actualPayout - expectedPayout),
          userId: userId,
          betAmount: userBet.bet_amount,
          multiplier: cashoutValue
        });
        return { 
          success: false, 
          message: 'payout calculation error detected' 
        };
      }

      return { 
        success: true, 
        message: 'cashout successful',
        cashoutAmount: result.payout_amount,
        cashoutValue: cashoutValue,
        cashoutMultiplier: cashoutValue, // Add for frontend compatibility
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

  // NEW: Implement generic auto-cashout method
  async onProcessAutoCashout(userId, targetValue) {
    try {
      // Check if user has an active bet
      const { data: userBet, error: betError } = await this.databaseService.supabase
        .from('game_bets')
        .select('*')
        .eq('user_id', userId)
        .eq('game_type', 'crash')
        .eq('round_id', this.crashState.currentRoundId)
        .eq('status', 'active')
        .single();

      if (betError || !userBet) {
        return { 
          success: false, 
          message: 'no active bet found to set auto-cashout for' 
        };
      }

      // Use the new generic set auto-cashout function
      const { data: result, error: autoCashoutError } = await this.databaseService.supabase.rpc('set_auto_cashout', {
        p_game_type: 'crash',
        p_user_id: userId,
        p_round_id: this.crashState.currentRoundId,
        p_target_value: targetValue
      });

      if (autoCashoutError) {
        console.error('error setting auto-cashout:', autoCashoutError);
        return { 
          success: false, 
          message: autoCashoutError.message || 'failed to set auto-cashout' 
        };
      }

      console.log(`auto-cashout set: ${targetValue}x for user ${userId}`);

      return { 
        success: true, 
        message: 'auto-cashout set successfully',
        targetValue: targetValue,
        targetMultiplier: targetValue, // Add for frontend compatibility
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
    const state = { ...this.crashState };
    
    // Add user-specific bet information if available
    if (userId && userId !== 'anonymous') {
      try {
        const { data: userBet, error } = await this.databaseService.supabase
          .from('game_bets')
          .select('*')
          .eq('user_id', userId)
          .eq('game_type', 'crash')
          .eq('round_id', this.crashState.currentRoundId)
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
        .eq('game_type', 'crash')
        .order('created_at', { ascending: false })
        .limit(limit);
      
      if (error) {
        console.error('error getting crash history:', error);
        return [];
      }
      
      return rounds || [];
    } catch (error) {
      console.error('error getting crash history:', error);
      return [];
    }
  }

  // Crash-specific methods
  async startCrashGame() {
    this.crashState.phase = 'playing';
    this.crashState.phaseStartTime = Date.now();
    await this.logger.gameEvent('crash', `game started: round ${this.crashState.currentRoundNumber}, crash point: ${this.crashState.currentCrashPoint}x`);
    
    // Update database state
    try {
      await this.databaseService.supabase
        .from('game_rounds')
        .update({
          game_data: this.databaseService.supabase.raw(`jsonb_set(jsonb_set(jsonb_set(game_data, '{phase}', '"playing"'), '{current_multiplier}', '1.00'), '{phase_start_time}', '"${new Date().toISOString()}"')`),
          updated_at: new Date().toISOString()
        })
        .eq('id', this.crashState.currentRoundId);
    } catch (error) {
      await this.logger.error('error updating crash game state', { error: error.message });
    }
  }

  async handleCrashGame() {
    // Only process each round once
    if (this.lastProcessedRound === this.crashState.currentRoundId) {
      return;
    }
    
    await this.logger.gameEvent('crash', `game ended at ${this.crashState.currentCrashPoint}x (round ${this.crashState.currentRoundNumber})`);
    
    // Update database state
    try {
      if (this.crashState.currentRoundId) {
        await this.databaseService.supabase
          .from('game_rounds')
          .update({
            game_data: this.databaseService.supabase.raw(`jsonb_set(jsonb_set(game_data, '{crash_multiplier}', '${parseFloat(this.crashState.currentCrashPoint).toFixed(4)}'), '{phase}', '"crashed"')`),
            status: 'completed',
            updated_at: new Date().toISOString()
          })
          .eq('id', this.crashState.currentRoundId);
      }
    } catch (error) {
      await this.logger.error('error updating crash game state', { error: error.message });
    }
    
    await this.processRemainingCrashPlayers();
  }

  async processRemainingCrashPlayers() {
    if (this.lastProcessedRound === this.crashState.currentRoundId) {
      return;
    }
    
    const roundId = this.crashState.currentRoundId;
    
    try {
      const { count: activeBetsCount } = await this.databaseService.supabase
        .from('game_bets')
        .select('*', { count: 'exact', head: true })
        .eq('round_id', roundId)
        .eq('game_type', 'crash')
        .eq('status', 'active');
      
      const { error: updateError } = await this.databaseService.supabase
        .from('game_bets')
        .update({
          status: 'crashed',
          updated_at: new Date().toISOString()
        })
        .eq('round_id', roundId)
        .eq('game_type', 'crash')
        .eq('status', 'active');
      
      if (updateError) {
        await this.logger.error('error updating crashed bets', { error: updateError.message });
      } else {
        if (activeBetsCount && activeBetsCount > 0) {
          await this.logger.info(`updated ${activeBetsCount} remaining crash bets to crashed status`);
        }
        this.lastProcessedRound = roundId;
      }
      
      // Update game data to reset active players count
      await this.databaseService.supabase
        .from('game_rounds')
        .update({
          game_data: this.databaseService.supabase.raw(`jsonb_set(game_data, '{active_players_count}', '0')`),
          updated_at: new Date().toISOString()
        })
        .eq('id', roundId);
        
    } catch (error) {
      await this.logger.error('error processing remaining crash players', { error: error.message });
    }
  }

  async startNewCrashRound() {
    // Complete the previous round first
    if (this.crashState.currentRoundId) {
      try {
        await this.databaseService.supabase
          .from('game_rounds')
          .update({
            status: 'completed',
            updated_at: new Date().toISOString()
          })
          .eq('id', this.crashState.currentRoundId);
        
        if (this.lastRoundCompleted !== this.crashState.currentRoundId) {
          await this.logger.info(`completed crash round ${this.crashState.currentRoundNumber} at ${this.crashState.currentCrashPoint}x`);
          this.lastRoundCompleted = this.crashState.currentRoundId;
          
          if (global.serverInstance && global.serverInstance.wsServer) {
            global.serverInstance.wsServer.broadcastToRoom('crash', {
              type: 'round_completed',
              roundNumber: this.crashState.currentRoundNumber,
              crashPoint: this.crashState.currentCrashPoint,
              timestamp: new Date().toISOString()
            });
          }
        }
      } catch (error) {
        await this.logger.error('error completing previous crash round', { error: error.message });
      }
    }
    
    const crypto = require('crypto');
    const serverSeed = crypto.randomBytes(32).toString('hex');
    const clientSeed = 'default';
    
    // Generate crash multiplier
    const crashMultiplier = this.generateCrashMultiplier(serverSeed, clientSeed);
    
    // Create game data for the new round
    const gameData = {
      phase: 'betting',
      crash_multiplier: crashMultiplier,
      game_hash: crypto.createHash('sha256').update(serverSeed + clientSeed).digest('hex'),
      server_seed: serverSeed,
      client_seed: clientSeed,
      current_multiplier: 1.00,
      active_players_count: 0,
      total_bet_amount: 0.00,
      phase_start_time: new Date().toISOString()
    };
    
    const { data: roundId, error: roundError } = await this.databaseService.supabase.rpc('create_game_round', {
      p_game_type: 'crash',
      p_game_data: gameData
    });
    
    if (roundError) {
      await this.logger.error('error creating new crash round', { error: roundError.message });
      return;
    }
    
    this.crashState.currentRoundId = roundId;
    this.crashState.currentRoundNumber = this.crashState.currentRoundNumber + 1;
    this.crashState.phase = 'betting';
    this.crashState.phaseStartTime = Date.now();
    this.crashState.currentMultiplier = 1.00;
    this.crashState.currentCrashPoint = crashMultiplier;
    this.crashState.gameHash = gameData.game_hash;
    this.crashState.serverSeed = serverSeed;
    this.crashState.clientSeed = clientSeed;
  }

  // Enhanced auto-cashout processing with maximum accuracy and reliability
  async processAutoCashouts() {
    try {
      // Only process if we have a valid round ID and are in playing phase
      if (!this.crashState.currentRoundId || this.crashState.phase !== 'playing') {
        return;
      }

      // Use high precision multiplier calculation - FIXED: Remove toFixed(4) to prevent precision loss
      const currentMultiplier = this.crashState.currentMultiplier;
      
      // VALIDATION: Ensure we're processing for an active round with enhanced checks
      const { data: roundData, error: roundError } = await this.databaseService.supabase
        .from('game_rounds')
        .select('status, game_data, round_number')
        .eq('id', this.crashState.currentRoundId)
        .eq('game_type', 'crash')
        .single();
      
      if (roundError || !roundData) {
        console.error('Auto-cashout validation failed: Round not found', { roundId: this.crashState.currentRoundId, error: roundError });
        return;
      }
      
      // VALIDATION: Only process for active rounds (not completed/crashed)
      if (roundData.status === 'completed' || roundData.game_data?.phase === 'crashed') {
        console.log('Auto-cashout skipped: Round already completed', { roundId: this.crashState.currentRoundId, status: roundData.status });
        return;
      }
      
      // VALIDATION: Ensure multiplier is reasonable
      if (currentMultiplier < 1.0 || currentMultiplier > 1000.0) {
        console.error('Auto-cashout validation failed: Invalid multiplier', { currentMultiplier, roundId: this.crashState.currentRoundId });
        return;
      }
      
      // CLEANUP: Deactivate stale auto-cashouts for completed rounds
      await this.cleanupStaleAutoCashouts();
      
      // Process auto-cashouts using the new generic database function with retry logic
      let autoCashoutResult = null;
      let autoCashoutError = null;
      let retryCount = 0;
      const maxRetries = 3;
      
      while (retryCount < maxRetries) {
        try {
          const result = await this.databaseService.supabase.rpc('process_auto_cashouts', {
            p_game_type: 'crash',
            p_round_id: this.crashState.currentRoundId,
            p_current_value: currentMultiplier
          });
          
          autoCashoutResult = result.data;
          autoCashoutError = result.error;
          break; // Success, exit retry loop
        } catch (error) {
          retryCount++;
          console.error(`Auto-cashout processing attempt ${retryCount} failed:`, error);
          
          if (retryCount >= maxRetries) {
            autoCashoutError = error;
            break;
          }
          
          // Wait before retry (exponential backoff)
          await new Promise(resolve => setTimeout(resolve, 50 * retryCount));
        }
      }
      
      if (autoCashoutError) {
        console.error('Auto-cashout error after retries:', autoCashoutError);
        return;
      }
      
      // If auto-cashouts were processed, send notifications to affected users
      if (autoCashoutResult && autoCashoutResult.processed_count > 0) {
        // Send individual notifications to each user who was auto-cashed out
        if (autoCashoutResult.processed_users && global.serverInstance && global.serverInstance.wsServer) {
          for (const userCashout of autoCashoutResult.processed_users) {
            try {
              // Validate cashout data before sending
              if (userCashout.user_id && userCashout.cashout_amount && userCashout.cashout_value) {
                global.serverInstance.wsServer.sendToUser(userCashout.user_id, {
                  type: 'auto_cashout_triggered',
                  cashoutMultiplier: parseFloat(userCashout.cashout_value).toFixed(4),
                  cashoutAmount: parseFloat(userCashout.cashout_amount).toFixed(2),
                  betAmount: parseFloat(userCashout.bet_amount).toFixed(2),
                  roundId: this.crashState.currentRoundId,
                  roundNumber: roundData.round_number,
                  timestamp: new Date().toISOString()
                });
              } else {
                console.error('Invalid auto-cashout data:', userCashout);
              }
            } catch (notificationError) {
              console.error('Error sending auto-cashout notification:', notificationError);
            }
          }
        }
      }
    } catch (error) {
      console.error('Critical error in processAutoCashouts:', error);
      // Don't let auto-cashout errors crash the game loop
    }
  }

  // CLEANUP MECHANISM: Deactivate stale auto-cashouts for completed rounds
  async cleanupStaleAutoCashouts() {
    try {
      const { data: cleanupResult, error: cleanupError } = await this.databaseService.supabase.rpc('cleanup_stale_auto_cashouts');
      
      if (cleanupError) {
        console.error('Error cleaning up stale auto-cashouts:', cleanupError);
        return;
      }
      
      if (cleanupResult && cleanupResult.cleaned_count > 0) {
        console.log(`Cleaned up ${cleanupResult.cleaned_count} stale auto-cashouts`);
      }
    } catch (error) {
      console.error('Error in cleanupStaleAutoCashouts:', error);
    }
  }

  // SCHEDULED CLEANUP: Periodic cleanup of stale auto-cashouts
  startAutoCashoutCleanupScheduler() {
    // Clean up every 5 minutes
    const CLEANUP_INTERVAL = 5 * 60 * 1000; // 5 minutes
    
    if (this.autoCashoutCleanupInterval) {
      clearInterval(this.autoCashoutCleanupInterval);
    }
    
    this.autoCashoutCleanupInterval = setInterval(async () => {
      try {
        await this.cleanupStaleAutoCashouts();
      } catch (error) {
        console.error('Error in scheduled auto-cashout cleanup:', error);
      }
    }, CLEANUP_INTERVAL);
    
    console.log('Auto-cashout cleanup scheduler started (5-minute intervals)');
  }

  // Stop the auto-cashout cleanup scheduler
  stopAutoCashoutCleanupScheduler() {
    if (this.autoCashoutCleanupInterval) {
      clearInterval(this.autoCashoutCleanupInterval);
      this.autoCashoutCleanupInterval = null;
      console.log('Auto-cashout cleanup scheduler stopped');
    }
  }

  async onStop() {
    // Crash-specific cleanup
    this.lastRoundCompleted = null;
    this.isStartingNewRound = false;
    this.lastProcessedRound = null;
    this.lastAutoCashoutCheck = 0;
    
    // Stop auto-cashout cleanup scheduler
    this.stopAutoCashoutCleanupScheduler();
  }

  cleanup() {
    super.cleanup();
    // Additional crash-specific cleanup
    this.crashState = {
      phase: 'waiting',
      currentRoundId: null,
      currentMultiplier: 1.00,
      phaseStartTime: Date.now(),
      resultPhaseStartTime: null,
      activePlayersCount: 0,
      totalBetAmount: 0.00,
      currentCrashPoint: 1.00,
      currentRoundNumber: 1,
      gameHash: null,
      serverSeed: null,
      clientSeed: null
    };
    
    // Stop auto-cashout cleanup scheduler
    this.stopAutoCashoutCleanupScheduler();
  }
}

module.exports = CrashGame; 
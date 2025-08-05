// API Routes - REST API endpoints
// Purpose: Handle HTTP requests for game operations

const express = require('express');
const router = express.Router();
const dbService = require('../server/database-service');
const LoggingService = require('../server/logging-service');

const logger = new LoggingService();

// Middleware to validate JWT token
const validateToken = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const { createClient } = require('@supabase/supabase-js');
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY
    );

    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    // Get user profile using admin client to bypass RLS
    const adminSupabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    const { data: userProfile, error: profileError } = await adminSupabase
      .from('users')
      .select('*')
      .eq('auth_user_id', user.id)
      .single();

    if (profileError || !userProfile) {
      await logger.error('user profile not found', { 
        userId: user.id,
        error: profileError?.message 
      });
      return res.status(401).json({ error: 'User profile not found' });
    }

    req.user = user;
    req.userProfile = userProfile;
    next();
  } catch (error) {
    await logger.error('token validation error', { error: error.message });
    return res.status(401).json({ error: 'Token validation failed' });
  }
};

// Middleware to check if user is admin
const validateAdmin = async (req, res, next) => {
  try {
    // First check if userProfile exists
    if (!req.userProfile) {
      await logger.error('admin validation failed - no user profile', { 
        userId: req.user?.id 
      });
      return res.status(403).json({ error: 'User profile not found' });
    }

    // Check if user has a role_id
    if (!req.userProfile.role_id) {
      await logger.error('admin validation failed - no role_id', { 
        userId: req.userProfile.id,
        userProfile: req.userProfile 
      });
      return res.status(403).json({ error: 'User role not assigned' });
    }

    // Use admin client to bypass RLS
    const { createClient } = require('@supabase/supabase-js');
    const adminSupabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    const { data: userRole, error: roleError } = await adminSupabase
      .from('user_roles')
      .select('name')
      .eq('id', req.userProfile.role_id)
      .single();

    if (roleError) {
      await logger.error('admin validation error - role lookup failed', { 
        error: roleError.message,
        roleId: req.userProfile.role_id 
      });
      return res.status(403).json({ error: 'Role validation failed' });
    }

    if (!userRole || userRole.name !== 'admin') {
      await logger.warning('admin validation failed - insufficient privileges', { 
        userId: req.userProfile.id,
        roleName: userRole?.name 
      });
      return res.status(403).json({ error: 'Admin privileges required' });
    }

    await logger.info('admin validation successful', { 
      userId: req.userProfile.id,
      roleName: userRole.name 
    });

    next();
  } catch (error) {
    await logger.error('admin validation error', { error: error.message });
    return res.status(403).json({ error: 'Admin validation failed' });
  }
};

// GET /api/balance - Get user balance
router.get('/balance', validateToken, async (req, res) => {
  try {
    const DatabaseService = require('../server/database-service');
    const dbService = new DatabaseService();
    await dbService.initialize();
    
    // Get user profile to get the database user ID
    const userProfile = await dbService.getUserProfile(req.user.id);
    if (!userProfile) {
      return res.status(404).json({ error: 'User profile not found' });
    }

    const balance = await dbService.getUserBalance(userProfile.id);
    
    res.json({ 
      balance,
      userId: userProfile.id,
      username: userProfile.username
    });
  } catch (error) {
    console.error('Error fetching balance:', error);
    res.status(500).json({ error: 'Failed to fetch balance' });
  }
});

// POST /api/bet - Place a bet
router.post('/bet', validateToken, async (req, res) => {
  try {
    const { gameType, betAmount, gameId } = req.body;
    const userProfile = req.userProfile;

    if (!gameType || !betAmount || betAmount <= 0) {
      await logger.warning('invalid bet request', { userId: userProfile.id, gameType, betAmount });
      return res.status(400).json({ error: 'Invalid bet parameters' });
    }

    // Check if user is banned
    const { data: userData, error: userError } = await dbService.supabase
      .from('users')
      .select('banned')
      .eq('id', userProfile.id)
      .single();

    if (userError) {
      await logger.error('error checking user ban status', { error: userError.message });
      return res.status(500).json({ error: 'Failed to verify user status' });
    }

    if (userData?.banned) {
      await logger.warning(`banned user ${userProfile.id} attempted to place bet via API`, { gameType, betAmount });
      return res.status(403).json({ error: 'You are banned from placing bets' });
    }

    // Process the bet
    const result = await dbService.processBet(gameType, userProfile.id, {
      betAmount: betAmount.toString(),
      gameId: gameId || `${gameType}_${Date.now()}`
    });

    if (result.success) {
      await logger.info(`user ${userProfile.id} placed ${gameType} bet`, { 
        userId: userProfile.id, 
        gameType, 
        betAmount, 
        gameId: result.gameId 
      });
      res.json(result);
    } else {
      await logger.warning(`bet placement failed for user ${userProfile.id}`, { 
        userId: userProfile.id, 
        gameType, 
        betAmount, 
        error: result.message 
      });
      res.status(400).json(result);
    }
  } catch (error) {
    await logger.error('bet placement error', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/crash/bet - Place a crash game bet
router.post('/crash/bet', validateToken, async (req, res) => {
  try {
    const { betAmount, autoCashoutMultiplier } = req.body;
    
    if (!betAmount || betAmount <= 0) {
      return res.status(400).json({ error: 'Invalid bet amount' });
    }

    const DatabaseService = require('../server/database-service');
    const dbService = new DatabaseService();
    await dbService.initialize();
    
    // Get user profile
    const userProfile = await dbService.getUserProfile(req.user.id);
    if (!userProfile) {
      return res.status(404).json({ error: 'User profile not found' });
    }

    // Check if user is banned
    const { data: userData, error: userError } = await dbService.supabase
      .from('users')
      .select('banned')
      .eq('id', userProfile.id)
      .single();
    
    if (userError) {
      console.error('Error checking user ban status:', userError);
      return res.status(500).json({ error: 'Failed to verify user status' });
    }
    
    if (userData?.banned) {
      return res.status(403).json({ error: 'You are banned from placing bets' });
    }

    // Use the crash bet function
    const result = await dbService.supabase.rpc('place_crash_bet', {
      p_round_id: 1, // This should be the current round ID
      p_bet_amount: betAmount,
      p_user_id: userProfile.id
    });

    if (result.error) {
      return res.status(400).json({ error: result.error.message });
    }

    res.json({ 
      success: true,
      ...result.data
    });
  } catch (error) {
    console.error('Error placing crash bet:', error);
    res.status(500).json({ error: 'Failed to place bet' });
  }
});

// POST /api/crash/cashout - Cash out from crash game
router.post('/crash/cashout', validateToken, async (req, res) => {
  try {
    const { roundId } = req.body;
    
    if (!roundId) {
      return res.status(400).json({ error: 'Round ID required' });
    }

    const DatabaseService = require('../server/database-service');
    const dbService = new DatabaseService();
    await dbService.initialize();
    
    // Get user profile
    const userProfile = await dbService.getUserProfile(req.user.id);
    if (!userProfile) {
      return res.status(404).json({ error: 'User profile not found' });
    }

    // Get current multiplier from game state
    const gameState = await dbService.supabase.rpc('get_crash_game_state');
    const currentMultiplier = gameState.data.current_multiplier;

    // Use the cashout function
    const result = await dbService.supabase.rpc('cashout_crash_bet', {
      p_round_id: roundId,
      p_user_id: userProfile.id,
      p_cashout_multiplier: currentMultiplier
    });

    if (result.error) {
      return res.status(400).json({ error: result.error.message });
    }

    res.json({ 
      success: true,
      ...result.data
    });
  } catch (error) {
    console.error('Error cashing out:', error);
    res.status(500).json({ error: 'Failed to cashout' });
  }
});

// GET /api/crash/state - Get current crash game state
router.get('/crash/state', validateToken, async (req, res) => {
  try {
    const DatabaseService = require('../server/database-service');
    const dbService = new DatabaseService();
    await dbService.initialize();
    
    const result = await dbService.supabase.rpc('get_crash_game_state');
    
    if (result.error) {
      return res.status(500).json({ error: result.error.message });
    }

    res.json(result.data);
  } catch (error) {
    console.error('Error fetching crash game state:', error);
    res.status(500).json({ error: 'Failed to fetch game state' });
  }
});

// POST /api/crash/new-round - Create new crash round
router.post('/crash/new-round', validateToken, async (req, res) => {
  try {
    const { serverSeed, clientSeed } = req.body;
    
    const DatabaseService = require('../server/database-service');
    const dbService = new DatabaseService();
    await dbService.initialize();
    
    const result = await dbService.supabase.rpc('create_crash_round', {
      p_server_seed: serverSeed || crypto.randomBytes(32).toString('hex'),
      p_client_seed: clientSeed || 'default'
    });
    
    if (result.error) {
      return res.status(500).json({ error: result.error.message });
    }

    res.json({ 
      success: true,
      roundId: result.data
    });
  } catch (error) {
    console.error('Error creating new crash round:', error);
    res.status(500).json({ error: 'Failed to create new round' });
  }
});

// GET /api/game-state - Get current game state
router.get('/game-state/:gamemode', validateToken, async (req, res) => {
  try {
    const { gamemode } = req.params;
    
    // For now, return a basic game state
    // This will be enhanced when we implement the game loop engine
    res.json({
      gamemode,
      phase: 'waiting',
      players: [],
      bets: [],
      startTime: null,
      endTime: null
    });
  } catch (error) {
    console.error('Error fetching game state:', error);
    res.status(500).json({ error: 'Failed to fetch game state' });
  }
});

// GET /api/game-history - Get user game history
router.get('/game-history', validateToken, async (req, res) => {
  try {
    const { limit = 50, offset = 0 } = req.query;
    
    const DatabaseService = require('../server/database-service');
    const dbService = new DatabaseService();
    await dbService.initialize();
    
    // Get user profile
    const userProfile = await dbService.getUserProfile(req.user.id);
    if (!userProfile) {
      return res.status(404).json({ error: 'User profile not found' });
    }

    const transactions = await dbService.getUserTransactions(
      userProfile.id, 
      parseInt(limit), 
      parseInt(offset)
    );

    res.json({ transactions });
  } catch (error) {
    console.error('Error fetching game history:', error);
    res.status(500).json({ error: 'Failed to fetch game history' });
  }
});

// POST /api/chat - Send chat message
router.post('/chat', validateToken, async (req, res) => {
  try {
    const { message, gamemode } = req.body;
    
    if (!message || message.trim().length === 0) {
      return res.status(400).json({ error: 'Message cannot be empty' });
    }

    if (!gamemode) {
      return res.status(400).json({ error: 'Gamemode required' });
    }

    // For now, just acknowledge the message
    // Chat will be handled via WebSocket in the future
    res.json({ 
      success: true,
      message: 'Message received (WebSocket implementation pending)'
    });
  } catch (error) {
    console.error('Error sending chat message:', error);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

// POST /api/emergency-stop - Emergency server shutdown (Admin only)
router.post('/emergency-stop', validateToken, validateAdmin, async (req, res) => {
  try {
    await logger.warning('emergency stop initiated by admin', { 
      adminId: req.userProfile.id,
      adminUsername: req.userProfile.username 
    });

    // Send response first
    res.json({ 
      success: true,
      message: 'Emergency stop initiated. Server will shutdown in 5 seconds.'
    });

    // Schedule server shutdown after 5 seconds to allow response to be sent
    setTimeout(async () => {
      try {
        await logger.error('emergency stop - shutting down server', { 
          adminId: req.userProfile.id 
        });
        
        // Get the server instance and call shutdown
        if (global.serverInstance) {
          await global.serverInstance.shutdown();
        } else {
          await logger.error('server instance not found, forcing process exit');
          process.exit(0);
        }
      } catch (error) {
        await logger.error('error during emergency shutdown', { error: error.message });
        process.exit(1);
      }
    }, 5000);

  } catch (error) {
    await logger.error('emergency stop error', { error: error.message });
    res.status(500).json({ error: 'Failed to initiate emergency stop' });
  }
});

// GET /api/game-config - Get all game configuration
router.get('/game-config', validateToken, async (req, res) => {
  try {
    const gameEngine = req.gameEngine;
    if (!gameEngine) {
      throw new Error('Game engine not available');
    }
    
    const config = gameEngine.getAllGameConfig();
    
    // Removed excessive logging - only log errors
    res.json({ success: true, config });
  } catch (error) {
    await logger.error('error getting game config', { error: error.message });
    res.status(500).json({ error: 'Failed to get game configuration' });
  }
});

// PUT /api/game-config - Update game configuration
router.put('/game-config', validateToken, async (req, res) => {
  try {
    const { config } = req.body;
    
    if (!config) {
      return res.status(400).json({ error: 'Configuration object required' });
    }

    const gameEngine = req.gameEngine;
    if (!gameEngine) {
      throw new Error('Game engine not available');
    }
    
    const updatedConfig = gameEngine.updateGameConfig(config);
    
    // Save to database
    await gameEngine.saveGameConfig();
    
    await logger.info('game config updated', { 
      userId: req.userProfile.id, 
      config: updatedConfig 
    });
    
    res.json({ success: true, config: updatedConfig });
  } catch (error) {
    await logger.error('error updating game config', { error: error.message });
    res.status(500).json({ error: 'Failed to update game configuration' });
  }
});

// POST /api/game-config/reset - Reset game configuration to defaults
router.post('/game-config/reset', validateToken, async (req, res) => {
  try {
    const gameEngine = req.gameEngine;
    if (!gameEngine) {
      throw new Error('Game engine not available');
    }
    
    const config = gameEngine.resetGameConfig();
    
    // Save to database
    await gameEngine.saveGameConfig();
    
    await logger.info('game config reset to defaults', { userId: req.userProfile.id });
    res.json({ success: true, config });
  } catch (error) {
    await logger.error('error resetting game config', { error: error.message });
    res.status(500).json({ error: 'Failed to reset game configuration' });
  }
});

// GET /api/game-config/bet-limits/:gamemode - Get bet limits for specific gamemode
router.get('/game-config/bet-limits/:gamemode', validateToken, async (req, res) => {
  try {
    const { gamemode } = req.params;
    const gameEngine = req.gameEngine;
    if (!gameEngine) {
      throw new Error('Game engine not available');
    }
    
    const betLimits = gameEngine.getBetLimits(gamemode);
    
    res.json({ success: true, gamemode, betLimits });
  } catch (error) {
    await logger.error('error getting bet limits', { error: error.message });
    res.status(500).json({ error: 'Failed to get bet limits' });
  }
});

// GET /api/game-config/house-edge/:gamemode - Get house edge for specific gamemode
router.get('/game-config/house-edge/:gamemode', validateToken, async (req, res) => {
  try {
    const { gamemode } = req.params;
    const gameEngine = req.gameEngine;
    if (!gameEngine) {
      throw new Error('Game engine not available');
    }
    
    const houseEdge = gameEngine.getHouseEdge(gamemode);
    
    res.json({ success: true, gamemode, houseEdge });
  } catch (error) {
    await logger.error('error getting house edge', { error: error.message });
    res.status(500).json({ error: 'Failed to get house edge' });
  }
});

// GET /api/chat-settings - Get public chat settings (no auth required)
router.get('/chat-settings', async (req, res) => {
  try {
    const gameEngine = req.gameEngine;
    if (!gameEngine) {
      return res.status(500).json({ error: 'Game engine not available' });
    }
    
    const chatSettings = gameEngine.getChatSettings();
    res.json({ chatSettings });
  } catch (error) {
    console.error('Error getting chat settings:', error);
    res.status(500).json({ error: 'Failed to get chat settings' });
  }
});

module.exports = router; 
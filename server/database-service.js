// Database Service - Centralized database operations
// Purpose: Handle all Supabase database interactions

const { createClient } = require('@supabase/supabase-js');

class DatabaseService {
  constructor() {
    this.supabase = null;
    this.initialized = false;
  }

  async initialize() {
    try {
      // Get environment variables
      const supabaseUrl = process.env.SUPABASE_URL;
      const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
      
      console.log('environment variables check:');
      console.log('supabase url:', supabaseUrl ? 'set' : 'missing');
      console.log('supabase service role key:', supabaseServiceKey ? 'set' : 'missing');
      
      if (!supabaseUrl || !supabaseServiceKey) {
        throw new Error('Missing Supabase environment variables');
      }

      // Initialize Supabase client
      this.supabase = createClient(supabaseUrl, supabaseServiceKey);
      
      // Test connection
      const { data, error } = await this.supabase
        .from('users')
        .select('count')
        .limit(1);
      
      if (error) {
        throw new Error(`Database connection failed: ${error.message}`);
      }

      this.initialized = true;
      console.log('database service initialized successfully');
      
    } catch (error) {
      console.error('failed to initialize database service:', error);
      throw error;
    }
  }

  // Get user balance
  async getUserBalance(userId) {
    if (!this.initialized) {
      throw new Error('Database service not initialized');
    }

    try {
      const { data, error } = await this.supabase
        .rpc('get_user_gc_balance', { p_user_id: userId });
      
      if (error) {
        console.error('error fetching user balance:', error);
        return 0;
      }
      
      return data || 0;
    } catch (error) {
      console.error('error in getUserBalance:', error);
      return 0;
    }
  }

  // Update user balance
  async updateBalance(userId, amount, transactionType, gameType = null, gameId = null, description = null) {
    if (!this.initialized) {
      throw new Error('Database service not initialized');
    }

    try {
      const { data, error } = await this.supabase
        .rpc('update_gc_balance', {
          p_user_id: userId,
          p_amount: amount,
          p_transaction_type: transactionType,
          p_game_type: gameType,
          p_game_id: gameId,
          p_description: description
        });
      
      if (error) {
        console.error('error updating balance:', error);
        throw new Error('Failed to update balance');
      }
      
      return data;
    } catch (error) {
      console.error('error in updateBalance:', error);
      throw error;
    }
  }

  // Get user transactions
  async getUserTransactions(userId, limit = 50, offset = 0) {
    if (!this.initialized) {
      throw new Error('Database service not initialized');
    }

    try {
      const { data, error } = await this.supabase
        .rpc('get_user_transactions', {
          p_user_id: userId,
          p_limit: limit,
          p_offset: offset
        });
      
      if (error) {
        console.error('error fetching transactions:', error);
        return [];
      }
      
      return data || [];
    } catch (error) {
      console.error('error in getUserTransactions:', error);
      return [];
    }
  }

  // Validate JWT token
  async validateToken(token) {
    if (!this.initialized) {
      throw new Error('Database service not initialized');
    }

    try {
      const { data: { user }, error } = await this.supabase.auth.getUser(token);
      
      if (error || !user) {
        return null;
      }
      
      return user;
    } catch (error) {
      console.error('error validating token:', error);
      return null;
    }
  }

  // Get user profile
  async getUserProfile(userId) {
    if (!this.initialized) {
      throw new Error('Database service not initialized');
    }

    try {
      const { data, error } = await this.supabase
        .from('users')
        .select(`
          *,
          user_roles (
            id,
            name,
            description
          )
        `)
        .eq('id', userId)
        .single();
      
      if (error) {
        console.error('error fetching user profile:', error);
        return null;
      }
      
      return data;
    } catch (error) {
      console.error('error in getUserProfile:', error);
      return null;
    }
  }

  async close() {
    // Supabase client doesn't need explicit closing
    this.initialized = false;
    console.log('database service closed');
  }
}

module.exports = DatabaseService; 
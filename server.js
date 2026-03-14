const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');
const aiService = require('./aiService');

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('.'));

// Supabase client initialization
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// In-memory session storage for context memory and confirmation state
const sessionContext = new Map();
const pendingConfirmations = new Map();
const businessAnalytics = new Map(); // Track time saved per session

/**
 * Executive AI-VAOM Controller - Business Solution Logic
 * Optimizes for speed, business efficiency, and "Instant" UI feedback
 * @param {string} user_input - The user's speech transcript
 * @param {number} last_id - The last order ID in session context
 * @param {boolean} is_waiting_for_confirm - If waiting for confirmation
 * @param {string} environment - "High Noise" | "Quiet"
 * @param {string} last_action - Last action performed
 * @param {Object} current_order_state - Current order state JSON
 * @returns {Object} - Executive Controller response schema
 */
function processExecutiveController(user_input, last_id = null, is_waiting_for_confirm = false, environment = 'Quiet', last_action = '', current_order_state = null) {
  const input = user_input.toLowerCase().trim();
  
  // Executive Controller response schema
  const response = {
    action: 'IGNORE',
    optimistic_ui: {
      action_preview: null,
      target_id: null,
      highlight_color: null
    },
    analytics: {
      time_saved: 0,
      intent_confidence: 0.0
    },
    data: {
      items_list: [],
      order_id: null,
      require_confirmation: false,
      context_reset: false
    },
    voice_response: 'Sorry, I didn\'t understand that. Please try again.',
    dashboard_hint: 'Command not recognized'
  };
  
  // KIOSK MODE - Shorten responses in noisy environments
  const isKioskMode = environment === 'High Noise';
  
  // Handle confirmation responses
  if (is_waiting_for_confirm) {
    const confirmWords = ['yes', 'yeah', 'yep', 'sure', 'do it', 'confirm', 'execute', 'proceed'];
    const cancelWords = ['no', 'cancel', 'stop', 'never mind', 'abort'];
    
    if (confirmWords.some(word => input.includes(word))) {
      response.action = 'CONFIRM_EXECUTE';
      response.voice_response = isKioskMode ? 'Confirmed.' : 'Executing your confirmed action.';
      response.dashboard_hint = 'Executing confirmed action...';
      response.optimistic_ui.action_preview = 'EXECUTING_ACTION';
      response.analytics.time_saved = 15;
      response.analytics.intent_confidence = 0.9;
      return response;
    } else if (cancelWords.some(word => input.includes(word))) {
      response.action = 'IGNORE';
      response.voice_response = isKioskMode ? 'Cancelled.' : 'Action cancelled.';
      response.dashboard_hint = 'Action cancelled';
      response.analytics.intent_confidence = 0.8;
      return response;
    }
  }
  
  // AMBIGUITY RESOLUTION - Detect context reset patterns
  const resetPatterns = ['wait', 'scratch', 'never mind', 'no actually', 'change my mind', 'instead'];
  const contextReset = resetPatterns.some(pattern => input.includes(pattern));
  
  if (contextReset) {
    response.data.context_reset = true;
    response.optimistic_ui.action_preview = 'RESETTING_CONTEXT';
    response.analytics.time_saved = 10; // Time saved by quick correction
    response.analytics.intent_confidence = 0.85;
  }
  
  // NOISE FILTER - Check for background noise or unrelated talk
  const gibberishPatterns = [/^[^a-zA-Z]+$/, /^(.)\1{3,}$/, /^[a-z]{1,2}$/i];
  const isGibberish = gibberishPatterns.some(pattern => pattern.test(input));
  const orderKeywords = ['order', 'buy', 'want', 'get', 'pizza', 'burger', 'coffee', 'sandwich', 'salad', 'pasta', 'cancel', 'delete', 'track', 'status', 'where', 'check', 'change', 'update', 'modify', 'add', 'and', 'scratch', 'wait'];
  const hasOrderKeywords = orderKeywords.some(keyword => input.includes(keyword));
  
  if (isGibberish || !hasOrderKeywords) {
    response.action = 'IGNORE';
    response.voice_response = ''; // Silent ignore for background noise
    response.dashboard_hint = 'Background noise filtered';
    response.analytics.intent_confidence = 0.1;
    return response;
  }
  
  // MULTI-COMMANDS - Parse multiple items with "and" or "with" (for replace commands)
  const items_list = [];
  let parts = [];
  
  // Check for "replace X with Y" or "swap X for Y" patterns
  if (input.includes('replace') || input.includes('swap')) {
    // Try to split on "with" or "for" for replace commands
    const withPattern = /(.+?)\s+(?:with|for)\s+(.+)/i;
    const withMatch = input.match(withPattern);
    if (withMatch) {
      parts = [withMatch[1], withMatch[2]];
    }
  }
  
  // If no "with" match, try "and" pattern
  if (parts.length === 0) {
    const andPattern = /(.+?)\s+and\s+(.+)/i;
    const multiMatch = input.match(andPattern);
    if (multiMatch) {
      parts = [multiMatch[1], multiMatch[2]];
    }
  }
  
  // Parse each part for items
  if (parts.length > 0) {
    for (const part of parts) {
      const itemData = parseItemFromText(part);
      if (itemData.item) {
        items_list.push(itemData);
      }
    }
  } else {
    // Single item
    const itemData = parseItemFromText(input);
    if (itemData.item) {
      items_list.push(itemData);
    }
  }
  
  // Extract order ID if mentioned
  const orderMatch = input.match(/\b(\d+)\b/);
  if (orderMatch) {
    response.data.order_id = parseInt(orderMatch[1]);
    response.optimistic_ui.target_id = response.data.order_id;
  }
  
  // Calculate intent confidence based on clarity
  response.analytics.intent_confidence = calculateIntentConfidence(input, items_list, response.data.order_id);
  
  // BUSINESS LOGIC - Calculate time saved
  const totalQuantity = items_list.reduce((sum, item) => sum + (item.qty || 1), 0);
  
  // ACTION MAPPING with Executive Controller logic
  if (input.includes('order') || input.includes('buy') || input.includes('want') || input.includes('get') || input.includes('add')) {
    if (items_list.length === 0) {
      response.action = 'CLARIFY';
      response.voice_response = isKioskMode ? 'What item?' : "I'd love to help you with that! What would you like to order today?";
      response.dashboard_hint = 'Awaiting item selection...';
      response.analytics.intent_confidence = 0.3;
    } else if (items_list.some(item => !item.qty)) {
      response.action = 'CLARIFY';
      response.data.items_list = items_list;
      const missingItem = items_list.find(item => !item.qty);
      response.voice_response = isKioskMode ? `How many ${missingItem.item}s?` : `Perfect choice! How many ${missingItem.item}s would you like?`;
      response.dashboard_hint = 'Awaiting quantity...';
      response.analytics.intent_confidence = 0.6;
    } else {
      response.action = 'CREATE';
      response.data.items_list = items_list;
      response.analytics.time_saved = totalQuantity * 15; // CREATE = 15s per item
      
      if (totalQuantity > 5) {
        response.data.require_confirmation = true;
        response.action = 'CLARIFY';
        response.voice_response = isKioskMode ? `${totalQuantity} items, confirm?` : `That's quite a lot - ${totalQuantity} items! Are you sure you'd like me to place this order?`;
        response.dashboard_hint = 'Confirmation required for large order';
        response.optimistic_ui.action_preview = 'PREPARING_LARGE_ORDER';
        response.optimistic_ui.highlight_color = '#ef4444'; // Red for large orders
      } else {
        const itemStr = items_list.map(i => `${i.qty} ${i.item}${i.qty > 1 ? 's' : ''}`).join(' and ');
        response.voice_response = isKioskMode ? `Adding ${items_list.map(i => i.item).join(', ')}.` : `Wonderful! I've added ${itemStr} to your order. Anything else you'd like?`;
        response.dashboard_hint = `Analytics update: +${response.analytics.time_saved}s saved`;
        response.optimistic_ui.action_preview = 'ADDING_ITEMS';
        response.optimistic_ui.highlight_color = '#22c55e'; // Green for success
      }
    }
  }
  else if (input.includes('where') || input.includes('status') || input.includes('check') || input.includes('track')) {
    response.action = 'TRACK';
    response.analytics.time_saved = 5; // Quick status check
    
    if (response.data.order_id) {
      response.voice_response = isKioskMode ? `Tracking order ${response.data.order_id}.` : `Checking the status of order ${response.data.order_id}.`;
      response.dashboard_hint = `Tracking #${response.data.order_id}...`;
      response.optimistic_ui.action_preview = 'HIGHLIGHTING_ROW';
      response.optimistic_ui.highlight_color = '#3b82f6'; // Blue for tracking
    } else if (items_list.length > 0) {
      response.data.items_list = items_list;
      response.voice_response = isKioskMode ? `Tracking ${items_list.map(i => i.item).join(', ')}.` : `Checking the status of your ${items_list.map(i => i.item).join(' and ')} orders.`;
      response.dashboard_hint = `Tracking ${items_list.map(i => i.item).join(', ')} orders...`;
      response.optimistic_ui.action_preview = 'HIGHLIGHTING_ROWS';
      response.optimistic_ui.highlight_color = '#3b82f6';
    } else {
      response.action = 'CLARIFY';
      response.voice_response = isKioskMode ? 'Which order?' : 'Which order would you like to check? Please provide the order number or item name.';
      response.dashboard_hint = 'Awaiting order details...';
      response.analytics.intent_confidence = 0.4;
    }
  }
  else if (input.includes('change') || input.includes('update') || input.includes('modify') || contextReset) {
    if (!response.data.order_id && !contextReset) {
      response.action = 'CLARIFY';
      response.voice_response = isKioskMode ? 'Which order?' : 'Which order would you like to update? Please provide the order number.';
      response.dashboard_hint = 'Awaiting order ID...';
      response.analytics.intent_confidence = 0.4;
    } else {
      response.action = 'UPDATE';
      response.data.items_list = items_list;
      response.analytics.time_saved = 20; // UPDATE = 20s
      
      if (contextReset) {
        response.voice_response = isKioskMode ? 'Updated.' : `Switched to ${items_list.map(i => i.item).join(' and ')}.`;
        response.optimistic_ui.action_preview = 'REPLACING_ITEM';
        response.optimistic_ui.highlight_color = '#f59e0b'; // Amber for changes
      } else {
        response.voice_response = isKioskMode ? `Updating order ${response.data.order_id}.` : `Updating order ${response.data.order_id}.`;
        response.dashboard_hint = `Analytics update: +${response.analytics.time_saved}s saved`;
        response.optimistic_ui.action_preview = 'UPDATING_ITEM';
        response.optimistic_ui.highlight_color = '#22c55e';
      }
    }
  }
  else if (input.includes('cancel') || input.includes('delete') || input.includes('remove')) {
    if (items_list.length > 0) {
      // If we have an item, go ahead and delete it
      response.action = 'DELETE';
      response.data.items_list = items_list;
      response.analytics.time_saved = 10; // DELETE = 10s
      response.voice_response = isKioskMode ? `Cancelling ${items_list[0].item}.` : `No problem! I'll cancel those ${items_list[0].item}s for you right away.`;
      response.dashboard_hint = `Cancelling ${items_list[0].item} order...`;
      response.optimistic_ui.action_preview = 'HIDING_ROW';
      response.optimistic_ui.highlight_color = '#ef4444'; // Red for deletion
    } else if (response.data.order_id) {
      // If we have an order ID but no item name
      response.action = 'DELETE';
      response.analytics.time_saved = 10;
      response.voice_response = isKioskMode ? `Cancelling order ${response.data.order_id}.` : `Of course! I'm cancelling order number ${response.data.order_id} for you now.`;
      response.dashboard_hint = `Cancelling order #${response.data.order_id}...`;
      response.optimistic_ui.action_preview = 'HIDING_ROW';
      response.optimistic_ui.highlight_color = '#ef4444';
    } else {
      response.action = 'CLARIFY';
      response.voice_response = isKioskMode ? 'Which order?' : `I'd be happy to cancel that for you. Which order would you like me to remove?`;
      response.dashboard_hint = 'Awaiting order details...';
      response.analytics.intent_confidence = 0.4;
    }
  }
  else if (input.includes('replace') || input.includes('swap')) {
    // Handle replace action - need two items
    if (items_list.length >= 2) {
      response.action = 'REPLACE';
      response.data.old_item = items_list[0].item;
      response.data.new_item = items_list[1].item;
      response.data.items_list = items_list;
      response.analytics.time_saved = 25; // REPLACE = 25s (delete + create)
      response.voice_response = isKioskMode ? `Replacing ${items_list[0].item} with ${items_list[1].item}.` : `Got it! I'll swap your ${items_list[0].item} for ${items_list[1].item}. One moment please!`;
      response.dashboard_hint = `Replacing ${items_list[0].item} with ${items_list[1].item}...`;
      response.optimistic_ui.action_preview = 'REPLACING_ITEM';
      response.optimistic_ui.highlight_color = '#f59e0b'; // Amber for replacement
    } else if (items_list.length === 1) {
      // Only have one item, need clarification
      response.action = 'CLARIFY';
      response.data.items_list = items_list;
      response.voice_response = isKioskMode ? 'Replace with what?' : `Sure thing! What would you like to replace your ${items_list[0].item} with?`;
      response.dashboard_hint = 'Awaiting replacement item...';
      response.analytics.intent_confidence = 0.5;
    } else {
      response.action = 'CLARIFY';
      response.voice_response = isKioskMode ? 'What to replace?' : `Happy to help with that! What item would you like to replace, and what should I put in its place?`;
      response.dashboard_hint = 'Awaiting items to replace...';
      response.analytics.intent_confidence = 0.3;
    }
  }
  
  return response;
}

/**
 * Calculate intent confidence based on input clarity
 */
function calculateIntentConfidence(input, items_list, order_id) {
  let confidence = 0.5; // Base confidence
  
  // Boost confidence for clear item mentions
  if (items_list.length > 0 && items_list.every(item => item.item && item.qty)) {
    confidence += 0.3;
  }
  
  // Boost confidence for specific order ID
  if (order_id) {
    confidence += 0.2;
  }
  
  // Reduce confidence for ambiguous input
  if (input.includes('maybe') || input.includes('perhaps')) {
    confidence -= 0.2;
  }
  
  return Math.min(Math.max(confidence, 0.0), 1.0);
}

/**
 * Helper function to parse item and quantity from text with fuzzy matching
 */
function parseItemFromText(text) {
  const lowerText = text.toLowerCase();
  
  // Extended food vocabulary with aliases for common mishearings
  const foodItems = [
    // Original items
    { name: 'pizza', aliases: ['pizza', 'pizzas', 'piza', 'pizaa', 'pitza', 'peices', 'pieces', 'peece', 'pees', 'peez', 'peetza'] },
    { name: 'burger', aliases: ['burger', 'burgers', 'burder', 'burgr', 'bgr', 'berder'] },
    { name: 'coffee', aliases: ['coffee', 'coffees', 'cofee', 'coffe', 'koffee', 'cafe', 'cofe'] },
    { name: 'sandwich', aliases: ['sandwich', 'sandwiches', 'sandwhich', 'sandwitch', 'sndwich'] },
    { name: 'salad', aliases: ['salad', 'salads', 'slad', 'sallad'] },
    { name: 'pasta', aliases: ['pasta', 'pastas', 'pastaa', 'pastta'] },
    { name: 'drink', aliases: ['drink', 'drinks', 'beverage'] },
    { name: 'water', aliases: ['water', 'waters'] },
    { name: 'soda', aliases: ['soda', 'sodas', 'pop', 'coke', 'pepsi'] },
    { name: 'fries', aliases: ['fries', 'fry', 'french fries', 'chips'] },
    { name: 'chicken', aliases: ['chicken', 'chickens', 'chikn', 'chiken'] },
    // Additional common items
    { name: 'noodles', aliases: ['noodles', 'noodle', 'pasta', 'ramen'] },
    { name: 'rice', aliases: ['rice', 'rices', 'fried rice'] },
    { name: 'steak', aliases: ['steak', 'steaks', 'beef'] },
    { name: 'fish', aliases: ['fish', 'fishes', 'seafood'] },
    { name: 'soup', aliases: ['soup', 'soups', 'broth'] },
    { name: 'taco', aliases: ['taco', 'tacos', 'burrito', 'burritos'] },
    { name: 'sushi', aliases: ['sushi', 'sashimi', 'roll', 'rolls'] },
    { name: 'donut', aliases: ['donut', 'donuts', 'doughnut', 'doughnuts'] },
    { name: 'cake', aliases: ['cake', 'cakes', 'pastry'] },
    { name: 'ice cream', aliases: ['ice cream', 'icecream', 'gelato'] },
    { name: 'tea', aliases: ['tea', 'teas', 'chai', 'green tea'] },
    { name: 'juice', aliases: ['juice', 'juices', 'smoothie'] },
    { name: 'milk', aliases: ['milk', 'milks'] },
    { name: 'beer', aliases: ['beer', 'beers', 'wine', 'alcohol'] },
    { name: 'bread', aliases: ['bread', 'breads', 'loaf'] },
    { name: 'croissant', aliases: ['croissant', 'croissants', 'pastry'] },
    { name: 'muffin', aliases: ['muffin', 'muffins'] },
    { name: 'pancake', aliases: ['pancake', 'pancakes', 'waffle', 'waffles'] },
    { name: 'egg', aliases: ['egg', 'eggs', 'omelette'] },
    { name: 'bacon', aliases: ['bacon', 'bacons'] },
    { name: 'ham', aliases: ['ham', 'hams', 'prosciutto'] },
    { name: 'cheese', aliases: ['cheese', 'cheeses'] },
    { name: 'fruit', aliases: ['fruit', 'fruits', 'apple', 'banana', 'orange'] },
    { name: 'vegetable', aliases: ['vegetable', 'vegetables', 'veggie', 'veggies'] },
    { name: 'chocolate', aliases: ['chocolate', 'chocolates', 'candy', 'sweet'] },
    { name: 'cookie', aliases: ['cookie', 'cookies', 'biscuit'] },
    { name: 'pie', aliases: ['pie', 'pies'] }
  ];
  
  // Try to find a matching item
  let matchedItem = null;
  let bestMatchScore = 0;
  
  for (const food of foodItems) {
    for (const alias of food.aliases) {
      // Exact match gets highest score
      if (lowerText.includes(alias)) {
        const score = alias.length; // Longer matches are more specific
        if (score > bestMatchScore) {
          bestMatchScore = score;
          matchedItem = food.name;
        }
      }
    }
  }
  
  // Extract quantity - look for numbers and number words
  let quantity = null;
  
  // Number words mapping
  const numberWords = {
    'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5,
    'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10,
    'eleven': 11, 'twelve': 12, 'dozen': 12, 'half dozen': 6
  };
  
  // Check for digit numbers first
  const digitMatch = text.match(/\b(\d+)\b/);
  if (digitMatch) {
    quantity = parseInt(digitMatch[1]);
  } else {
    // Check for word numbers
    for (const [word, num] of Object.entries(numberWords)) {
      if (lowerText.includes(word)) {
        quantity = num;
        break;
      }
    }
  }
  
  // If no quantity found but we have an item, default to 1
  if (matchedItem && !quantity) {
    quantity = 1;
  }
  
  return { item: matchedItem, qty: quantity };
}

/**
 * Legacy function for backward compatibility
 * @param {string} voiceCommand - The voice command string
 */
function handleVoiceIntent(voiceCommand) {
  const result = processExecutiveController(voiceCommand);
  console.log(`VOICE INTENT: ${result.action} - "${voiceCommand}"`);
  return result.action;
}

// CRUD Endpoints for Orders

// GET - Retrieve all orders
app.get('/api/orders', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('orders')
      .select('*')
      .order('created_at', { ascending: false });
    
    if (error) {
      console.error('Error fetching orders:', error);
      return res.status(500).json({ error: 'Failed to fetch orders' });
    }
    
    res.json(data);
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET - Retrieve single order by ID
app.get('/api/orders/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const { data, error } = await supabase
      .from('orders')
      .select('*')
      .eq('id', id)
      .single();
    
    if (error) {
      if (error.code === 'PGRST116') {
        return res.status(404).json({ error: 'Order not found' });
      }
      console.error('Error fetching order:', error);
      return res.status(500).json({ error: 'Failed to fetch order' });
    }
    
    res.json(data);
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST - Create new order
app.post('/api/orders', async (req, res) => {
  try {
    const { item, quantity, status = 'pending' } = req.body;
    
    if (!item || !quantity) {
      return res.status(400).json({ error: 'Item and quantity are required' });
    }
    
    const { data, error } = await supabase
      .from('orders')
      .insert([{ item, quantity, status }])
      .select();
    
    if (error) {
      console.error('Error creating order:', error);
      return res.status(500).json({ error: 'Failed to create order' });
    }
    
    // Live Monitor Log
    console.log('\n📦 NEW ORDER RECEIVED');
    console.log(`Item: ${data[0].item}`);
    console.log(`Quantity: ${data[0].quantity}`);
    console.log(`Status: ${data[0].status}`);
    console.log('------------------------\n');
    
    res.status(201).json(data[0]);
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH - Update order status
app.patch('/api/orders/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    
    if (!status) {
      return res.status(400).json({ error: 'Status is required' });
    }
    
    const { data, error } = await supabase
      .from('orders')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select();
    
    if (error) {
      console.error('Error updating order status:', error);
      return res.status(500).json({ error: 'Failed to update order status' });
    }
    
    if (data.length === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }
    
    res.json(data[0]);
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH - Update order (general)
app.patch('/api/orders/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { item, quantity, status } = req.body;
    
    const updateData = { updated_at: new Date().toISOString() };
    if (item) updateData.item = item;
    if (quantity) updateData.quantity = quantity;
    if (status) updateData.status = status;
    
    const { data, error } = await supabase
      .from('orders')
      .update(updateData)
      .eq('id', id)
      .select();
    
    if (error) {
      console.error('Error updating order:', error);
      return res.status(500).json({ error: 'Failed to update order' });
    }
    
    if (data.length === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }
    
    res.json(data[0]);
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE - Cancel/delete order
app.delete('/api/orders/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const { data, error } = await supabase
      .from('orders')
      .delete()
      .eq('id', id)
      .select();
    
    if (error) {
      console.error('Error deleting order:', error);
      return res.status(500).json({ error: 'Failed to delete order' });
    }
    
    if (data.length === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }
    
    res.json({ message: 'Order deleted successfully', deletedOrder: data[0] });
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// NEW: Gemini AI-powered voice intent processing with optimistic UI
app.post('/api/voice-process', async (req, res) => {
  try {
    const { 
      command, 
      sessionId = 'default',
      environment = 'Quiet',
      lastOrderId = null
    } = req.body;
    
    if (!command) {
      return res.status(400).json({ error: 'Command is required' });
    }
    
    // Context reset detection - check for cancellation phrases
    const contextResetPhrases = ['no', 'wait', 'actually', 'scratch that', 'never mind', 'cancel', 'changed my mind'];
    const hasContextReset = contextResetPhrases.some(phrase => 
      command.toLowerCase().includes(phrase)
    );
    
    // Process voice command with Gemini AI
    let extractedData;
    let contextReset = false;
    let action = 'CREATE';
    let requireConfirmation = false;
    
    if (hasContextReset) {
      // Handle context reset - extract new item after reset phrase
      const cleanCommand = command.replace(/^(no|wait|actually|scratch that|never mind|cancel)\s*,?\s*/i, '');
      extractedData = await aiService.processVoiceCommand(cleanCommand);
      contextReset = true;
      action = 'UPDATE';
    } else if (command.toLowerCase().includes('delete') || command.toLowerCase().includes('cancel')) {
      // Safety: Delete requires confirmation
      action = 'DELETE';
      requireConfirmation = true;
      const orderIdMatch = command.match(/\d+/);
      extractedData = { order_id: orderIdMatch ? parseInt(orderIdMatch[0]) : lastOrderId };
    } else {
      // Normal order creation
      extractedData = await aiService.processVoiceCommand(command);
      action = extractedData?.action || 'CREATE';
      console.log('Gemini extracted:', extractedData);
    }
    
    // Kiosk mode: 3 words max response
    let voiceResponse;
    if (environment === 'High Noise') {
      if (action === 'CREATE' && extractedData) {
        voiceResponse = `Adding ${extractedData.quantity} ${extractedData.item}.`;
      } else if (action === 'DELETE') {
        voiceResponse = 'Delete order?';
      } else if (contextReset) {
        voiceResponse = 'Updated.';
      } else {
        voiceResponse = 'Processing.';
      }
    } else {
      if (action === 'CREATE' && extractedData) {
        voiceResponse = `Adding ${extractedData.quantity} ${extractedData.item} to your order.`;
      } else if (action === 'DELETE') {
        voiceResponse = 'Are you sure you want to delete this order?';
      } else if (contextReset) {
        voiceResponse = `Correction detected. Switched to ${extractedData.item}.`;
      } else {
        voiceResponse = 'Processing your request.';
      }
    }
    
    // Calculate optimistic UI hints
    const optimisticUI = {
      action_preview: action === 'CREATE' ? 'ADDING_ITEMS' : 
                     action === 'DELETE' ? 'HIDING_ROW' : 
                     contextReset ? 'REPLACING_ITEM' : 'UPDATING_ITEM',
      target_id: extractedData?.order_id || lastOrderId,
      highlight_color: action === 'DELETE' ? '#ef4444' : 
                      contextReset ? '#f59e0b' : '#22c55e'
    };
    
    // Calculate analytics
    const analytics = {
      time_saved: action === 'CREATE' ? 15 : action === 'UPDATE' ? 20 : 10,
      intent_confidence: extractedData ? 0.95 : 0.5
    };
    
    // Build response
    const response = {
      command,
      sessionId,
      environment,
      action,
      context_reset: contextReset,
      data: {
        ...extractedData,
        require_confirmation: requireConfirmation
      },
      optimistic_ui: optimisticUI,
      analytics,
      voice_response: voiceResponse,
      dashboard_hint: contextReset ? 'Correction detected' : 
                     action === 'CREATE' ? `Analytics: +${analytics.time_saved}s saved` : 
                     'Processing...'
    };
    
    // If CREATE action and not requiring confirmation, save to database
    if (action === 'CREATE' && extractedData && !requireConfirmation) {
      const savedOrder = await aiService.saveOrder(extractedData);
      if (savedOrder) {
        response.data.order_id = savedOrder.id;
        response.data.saved_order = savedOrder;
        
        // Live Monitor Log
        console.log('\n📦 NEW ORDER RECEIVED');
        console.log(`Item: ${savedOrder.item}`);
        console.log(`Quantity: ${savedOrder.quantity}`);
        console.log(`Status: ${savedOrder.status}`);
        console.log('------------------------\n');
        
        // Update session context
        sessionContext.set(sessionId, savedOrder.id);
        
        // Update business analytics
        const currentTotal = businessAnalytics.get(sessionId) || 0;
        businessAnalytics.set(sessionId, currentTotal + analytics.time_saved);
      }
    }
    
    console.log('Gemini AI Processing:', response);
    
    res.json(response);
    
  } catch (error) {
    console.error('Error processing voice with Gemini:', error);
    res.status(500).json({ error: 'Failed to process voice command with AI' });
  }
});

// Enhanced voice intent processing endpoint with Executive Controller logic
app.post('/api/voice-intent', async (req, res) => {
  try {
    const { 
      command, 
      sessionId = 'default',
      environment = 'Quiet',
      lastAction = '',
      currentOrderState = null
    } = req.body;
    
    if (!command) {
      return res.status(400).json({ error: 'Command is required' });
    }
    
    // Get last order ID from session context
    const lastOrderId = sessionContext.get(sessionId) || null;
    
    // Check if waiting for confirmation
    const isWaitingForConfirm = pendingConfirmations.get(sessionId) || false;
    
    // Process with Executive Controller logic
    const executiveResponse = processExecutiveController(
      command, 
      lastOrderId, 
      isWaitingForConfirm, 
      environment, 
      lastAction, 
      currentOrderState
    );
    
    // Update business analytics
    if (executiveResponse.analytics.time_saved > 0) {
      const currentTotal = businessAnalytics.get(sessionId) || 0;
      businessAnalytics.set(sessionId, currentTotal + executiveResponse.analytics.time_saved);
    }
    
    // Handle confirmation state management and execute database actions
    if (executiveResponse.action === 'CLARIFY' && executiveResponse.data.require_confirmation) {
      pendingConfirmations.set(sessionId, true);
      // Store the pending action data for execution
      sessionContext.set(sessionId + '_pending', executiveResponse.data);
    } else if (executiveResponse.action === 'CONFIRM_EXECUTE') {
      // Execute the pending action
      const pendingData = sessionContext.get(sessionId + '_pending');
      if (pendingData) {
        executiveResponse.data = pendingData;
      }
      pendingConfirmations.delete(sessionId);
      sessionContext.delete(sessionId + '_pending');
    } else if (executiveResponse.action === 'CREATE' && !executiveResponse.data.require_confirmation) {
      // Actually save order to database
      const items = executiveResponse.data.items_list;
      if (items && items.length > 0) {
        const savedOrders = [];
        for (const itemData of items) {
          const { data, error } = await supabase
            .from('orders')
            .insert([{ 
              item: itemData.item, 
              quantity: itemData.qty || 1, 
              status: 'pending',
              price: 0.0
            }])
            .select()
            .single();
          
          if (error) {
            console.error('Error saving order:', error);
          } else {
            savedOrders.push(data);
            console.log('\n➕ CREATE: New order created');
            console.log(`   Item: ${data.item}`);
            console.log(`   Quantity: ${data.quantity}`);
            console.log(`   Status: ${data.status}`);
            console.log(`   Order ID: ${data.id}`);
            console.log('------------------------\n');
          }
        }
        
        if (savedOrders.length > 0) {
          executiveResponse.data.saved_order = savedOrders[0];
          executiveResponse.data.order_id = savedOrders[0].id;
        }
      }
      pendingConfirmations.delete(sessionId);
      sessionContext.delete(sessionId + '_pending');
    } else if (executiveResponse.action === 'DELETE') {
      // Find and delete pending order(s) for the item with quantity support
      const items = executiveResponse.data.items_list;
      const itemToDelete = items && items.length > 0 ? items[0].item : null;
      const deleteQty = items && items[0] ? (items[0].qty || 1) : 1;
      const isDeleteAll = input.includes('all');
      
      if (itemToDelete) {
        // Find all pending orders for this item
        const { data: orders, error: findError } = await supabase
          .from('orders')
          .select('*')
          .eq('item', itemToDelete)
          .eq('status', 'pending')
          .order('created_at', { ascending: false });
        
        if (!findError && orders && orders.length > 0) {
          let deletedCount = 0;
          let deletedOrders = [];
          let totalDeletedQty = 0;
          const targetQty = isDeleteAll ? Infinity : deleteQty;
          
          // Delete orders until we've removed targetQty items
          for (const order of orders) {
            if (totalDeletedQty >= targetQty) break;
            
            const { error: deleteError } = await supabase
              .from('orders')
              .delete()
              .eq('id', order.id);
            
            if (!deleteError) {
              deletedOrders.push(order);
              totalDeletedQty += order.quantity;
              deletedCount++;
            }
          }
          
          if (deletedCount > 0) {
            executiveResponse.data.deleted_orders = deletedOrders;
            executiveResponse.data.order_id = deletedOrders[0].id;
            
            if (isDeleteAll) {
              executiveResponse.voice_response = `Cancelled all ${totalDeletedQty} ${itemToDelete} orders.`;
              console.log('\n🗑️ DELETE: All orders cancelled');
            } else {
              executiveResponse.voice_response = `Cancelled ${totalDeletedQty} ${itemToDelete}.`;
              console.log('\n🗑️ DELETE: Order(s) cancelled');
            }
            console.log(`   Item: ${itemToDelete}`);
            console.log(`   Orders deleted: ${deletedCount}`);
            console.log(`   Total quantity: ${totalDeletedQty}`);
            console.log('------------------------\n');
          } else {
            executiveResponse.voice_response = `No pending ${itemToDelete} orders found to cancel.`;
          }
        } else {
          executiveResponse.voice_response = `No pending ${itemToDelete} orders found to cancel.`;
        }
      }
      pendingConfirmations.delete(sessionId);
      sessionContext.delete(sessionId + '_pending');
    } else if (executiveResponse.action === 'UPDATE') {
      // Find and update the most recent pending order
      const items = executiveResponse.data.items_list;
      
      if (items && items.length > 0) {
        const itemToUpdate = items[0].item;
        const newQty = items[0].qty || 1;
        
        // Find the most recent pending order for this item
        const { data: orders, error: findError } = await supabase
          .from('orders')
          .select('*')
          .eq('item', itemToUpdate)
          .eq('status', 'pending')
          .order('created_at', { ascending: false })
          .limit(1);
        
        if (!findError && orders && orders.length > 0) {
          const orderToUpdate = orders[0];
          
          // Update the quantity
          const { data, error: updateError } = await supabase
            .from('orders')
            .update({ quantity: newQty, updated_at: new Date().toISOString() })
            .eq('id', orderToUpdate.id)
            .select()
            .single();
          
          if (!updateError) {
            executiveResponse.data.updated_order = data;
            executiveResponse.data.order_id = data.id;
            executiveResponse.voice_response = `Updated ${data.item} quantity to ${newQty}.`;
            console.log('\n✏️ UPDATE: Order updated');
            console.log(`   Item: ${data.item}`);
            console.log(`   New Quantity: ${newQty}`);
            console.log(`   Order ID: ${data.id}`);
            console.log('------------------------\n');
          }
        }
      }
      pendingConfirmations.delete(sessionId);
      sessionContext.delete(sessionId + '_pending');
    } else if (executiveResponse.action === 'TRACK') {
      // Find and return the status of the most recent order
      const items = executiveResponse.data.items_list;
      const itemToTrack = items && items.length > 0 ? items[0].item : null;
      
      if (itemToTrack) {
        const { data: orders, error: findError } = await supabase
          .from('orders')
          .select('*')
          .eq('item', itemToTrack)
          .order('created_at', { ascending: false })
          .limit(1);
        
        if (!findError && orders && orders.length > 0) {
          const order = orders[0];
          executiveResponse.data.order_status = order.status;
          executiveResponse.data.order_id = order.id;
          executiveResponse.voice_response = `Your ${order.item} is currently ${order.status}.`;
          console.log('\n🔍 TRACK: Order status checked');
          console.log(`   Item: ${order.item}`);
          console.log(`   Status: ${order.status}`);
          console.log(`   Order ID: ${order.id}`);
          console.log('------------------------\n');
        } else {
          executiveResponse.voice_response = `No order found for ${itemToTrack}.`;
        }
      }
      pendingConfirmations.delete(sessionId);
      sessionContext.delete(sessionId + '_pending');
    } else if (executiveResponse.action === 'REPLACE') {
      // Execute replace: delete old item order(s), create new item order
      const oldItem = executiveResponse.data.old_item;
      const newItem = executiveResponse.data.new_item;
      const items = executiveResponse.data.items_list;
      const oldQty = items && items[0] ? (items[0].qty || 1) : 1;
      const newQty = items && items[1] ? (items[1].qty || 1) : 1;
      
      if (oldItem && newItem) {
        // Find pending orders for oldItem
        const { data: orders, error: findError } = await supabase
          .from('orders')
          .select('*')
          .eq('item', oldItem)
          .eq('status', 'pending')
          .order('created_at', { ascending: false });
        
        if (!findError && orders && orders.length > 0) {
          let deletedCount = 0;
          let deletedOrders = [];
          let totalDeletedQty = 0;
          
          // Delete orders until we've removed oldQty items
          for (const order of orders) {
            if (totalDeletedQty >= oldQty) break;
            
            const { error: deleteError } = await supabase
              .from('orders')
              .delete()
              .eq('id', order.id);
            
            if (!deleteError) {
              deletedOrders.push(order);
              totalDeletedQty += order.quantity;
              deletedCount++;
            }
          }
          
          if (deletedCount > 0) {
            // Create new order with newQty
            const { data: newOrder, error: insertError } = await supabase
              .from('orders')
              .insert([{
                item: newItem,
                quantity: newQty,
                price: 0.0,
                status: 'pending'
              }])
              .select()
              .single();
            
            if (!insertError) {
              executiveResponse.data.deleted_orders = deletedOrders;
              executiveResponse.data.new_order = newOrder;
              executiveResponse.data.order_id = newOrder.id;
              executiveResponse.voice_response = `Replaced ${totalDeletedQty} ${oldItem} with ${newQty} ${newItem}.`;
              console.log('\n🔄 REPLACE: Order(s) replaced');
              console.log(`   Deleted: ${deletedCount} order(s) of ${oldItem} (total qty: ${totalDeletedQty})`);
              console.log(`   Created: ${newOrder.item} x${newQty} (ID: ${newOrder.id})`);
              console.log('------------------------\n');
            }
          }
        } else {
          executiveResponse.voice_response = `No pending ${oldItem} order found to replace.`;
        }
      }
      pendingConfirmations.delete(sessionId);
      sessionContext.delete(sessionId + '_pending');
    } else if (executiveResponse.action !== 'IGNORE') {
      // Clear confirmation state for other actions
      pendingConfirmations.delete(sessionId);
      sessionContext.delete(sessionId + '_pending');
    }
    
    // Update session context if this action creates an order
    if (executiveResponse.action === 'CREATE' && executiveResponse.data.order_id) {
      sessionContext.set(sessionId, executiveResponse.data.order_id);
    } else if (executiveResponse.data.order_id) {
      // Update context with referenced order ID
      sessionContext.set(sessionId, executiveResponse.data.order_id);
    }
    
    console.log(`Executive Controller Processing:`, {
      command,
      sessionId,
      environment,
      lastOrderId,
      isWaitingForConfirm,
      response: executiveResponse
    });

    res.json({
      command,
      sessionId,
      environment,
      lastOrderId,
      isWaitingForConfirm: pendingConfirmations.get(sessionId) || false,
      total_time_saved: businessAnalytics.get(sessionId) || 0,
      ...executiveResponse
    });
  } catch (error) {
    console.error('Error processing voice intent:', error);
    res.status(500).json({ error: 'Failed to process voice intent' });
  }
});

// Session context management endpoint
app.get('/api/session/:sessionId/context', (req, res) => {
  const { sessionId } = req.params;
  const context = {
    lastOrderId: sessionContext.get(sessionId) || null,
    total_time_saved: businessAnalytics.get(sessionId) || 0,
    isWaitingForConfirm: pendingConfirmations.get(sessionId) || false
  };
  res.json(context);
});

// Business analytics endpoint
app.get('/api/analytics/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  const analytics = {
    total_time_saved: businessAnalytics.get(sessionId) || 0,
    session_id: sessionId,
    timestamp: new Date().toISOString()
  };
  res.json(analytics);
});

// Clear session context
app.delete('/api/session/:sessionId/context', (req, res) => {
  const { sessionId } = req.params;
  sessionContext.delete(sessionId);
  sessionContext.delete(sessionId + '_pending');
  pendingConfirmations.delete(sessionId);
  businessAnalytics.delete(sessionId);
  res.json({ message: 'Session context cleared' });
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    service: 'VAOM Backend'
  });
});

// Test Supabase connection - insert test order
app.post('/api/test-connection', async (req, res) => {
  try {
    const testOrder = {
      item: 'test-item',
      quantity: 1,
      price: 0.0,
      status: 'pending'
    };
    
    console.log('Testing Supabase connection with:', testOrder);
    
    const { data, error } = await supabase
      .from('orders')
      .insert([testOrder])
      .select()
      .single();
    
    if (error) {
      console.error('Supabase test insert failed:', error);
      return res.status(500).json({
        success: false,
        error: error.message,
        details: error
      });
    }
    
    console.log('Test order inserted successfully:', data);
    res.json({
      success: true,
      message: 'Supabase connection working! Test order inserted.',
      insertedData: data
    });
    
  } catch (error) {
    console.error('Test connection error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 VAOM Backend Server running on port ${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/api/health`);
  console.log(`🎤 Voice intent endpoint: http://localhost:${PORT}/api/voice-intent`);
  console.log(`📦 Orders endpoints: http://localhost:${PORT}/api/orders`);
});

module.exports = app;

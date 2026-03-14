const { GoogleGenerativeAI } = require('@google/generative-ai');
const supabase = require('./db');
require('dotenv').config();

// Initialize Gemini 1.5 Flash
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

/**
 * Process voice command using Gemini 1.5 Flash as the Complete Executive Brain.
 * This removes all hardcoded regex/keywords and uses semantic understanding.
 * @param {Object} params - { text, lastOrderId, environment, sessionId }
 * @returns {Promise<Object>} - Executive Controller Response Schema
 */
async function processExecutiveBrain({ text, lastOrderId, environment = 'Quiet', sessionId }) {
  try {
    const isKioskMode = environment === 'High Noise';
    
    const prompt = `
You are the Executive AI-VAOM Controller, a professional business logic engine. 
Your task is to parse user speech for restaurant/inventory commands and return a precise JSON response.

CONTEXT:
- Current Environment: ${environment} (In "High Noise", keep voice_response under 5 words)
- Last Order ID in Session: ${lastOrderId || 'None'}

INTENT CATEGORIES:
- CREATE: Placing new orders
- DELETE: Removing/Cancelling orders
- UPDATE: Changing quantities or details
- TRACK: Status checks
- REPLACE: Swapping one item for another
- CLARIFY: If the command is missing info (like quantity or item name)
- IGNORE: If the text is just background noise or gibberish

BUSINESS ANALYTICS DECK:
- CREATE saves 15s per item.
- UPDATE saves 20s.
- DELETE saves 10s.
- TRACK saves 5s.

RETURN THIS JSON FORMAT ONLY:
{
  "action": "CREATE | DELETE | UPDATE | TRACK | REPLACE | CLARIFY | IGNORE",
  "optimistic_ui": {
    "action_preview": "ADDING_ITEMS | HIDING_ROW | UPDATING_ITEM | REPLACING_ITEM | HIGHLIGHTING_ROW",
    "target_id": "Number (extracted order ID or lastOrderId)",
    "highlight_color": "Hex code (#22c55e for green/success, #ef4444 for red/delete, #f59e0b for amber/change)"
  },
  "analytics": {
    "time_saved": Number (seconds saved based on intent),
    "intent_confidence": Number (0.0 to 1.0)
  },
  "data": {
    "items_list": [{"item": "singular_name", "qty": Number}],
    "order_id": Number,
    "old_item": "string (for REPLACE)",
    "new_item": "string (for REPLACE)",
    "require_confirmation": Boolean,
    "context_reset": Boolean (True if user said "actually", "no wait", "scratch that")
  },
  "voice_response": "Short, professional confirmation matching the environment",
  "dashboard_hint": "Brief status text for the UI"
}

USER INPUT: "${text}"
`;

    const result = await model.generateContent(prompt);
    const textResponse = result.response.text().trim();
    
    // Clean JSON from Markdown blocks
    let jsonStr = textResponse.replace(/^```json\n?/, '').replace(/```$/, '').trim();
    const parsed = JSON.parse(jsonStr);

    console.log(`\n🧠 AI BRAIN DECISION: [${parsed.action}] Confidence: ${parsed.analytics.intent_confidence}`);
    return parsed;

  } catch (error) {
    console.error('AI Brain Error:', error.message);
    return {
      action: 'IGNORE',
      voice_response: 'Internal brain error. Please try again.',
      analytics: { time_saved: 0, intent_confidence: 0 }
    };
  }
}

/**
 * Note: Removed fallbackParse to rely 100% on Gemini AI for natural language understanding.
 * This ensures sophisticated linguistic processing without keyword limitations.
 */

/**
 * Save order to Supabase database
 * @param {Object} orderData - {item, quantity}
 * @returns {Promise<Object>} - Saved order or null if failed
 */
async function saveOrder(orderData) {
  try {
    if (!orderData || !orderData.item || !orderData.quantity) {
      console.log('Invalid order data:', orderData);
      return null;
    }

    console.log('Attempting to save:', orderData);

    const { data, error } = await supabase
      .from('orders')
      .insert([{
        item: orderData.item,
        quantity: orderData.quantity,
        price: 0.0,
        status: 'pending'
      }])
      .select()
      .single();

    if (error) {
      console.error('Error saving order to Supabase:', error);
      return null;
    }

    // Live Monitor Log
    console.log('\n📦 NEW ORDER RECEIVED (via aiService)');
    console.log(`Item: ${data.item}`);
    console.log(`Quantity: ${data.quantity}`);
    console.log(`Status: ${data.status}`);
    console.log('------------------------\n');

    console.log('Order saved successfully:', data);
    return data;

  } catch (error) {
    console.error('Error in saveOrder:', error);
    return null;
  }
}

/**
 * Process voice command and execute database action (CREATE, UPDATE, DELETE, TRACK)
 * @param {string} text - Voice command text
 * @returns {Promise<Object>} - Complete result with extracted data and database operation result
 */
async function processAndSaveVoiceCommand(text) {
  try {
    // Step 1: Extract action, item and quantity using Gemini AI
    const extracted = await processVoiceCommand(text);
    
    // Handle ERROR from AI processing
    if (extracted && extracted.action === 'ERROR') {
      return {
        success: false,
        error: extracted.error || 'AI processing failed. Please try again.',
        extracted: extracted,
        result: null
      };
    }
    
    if (!extracted || extracted.action === 'IGNORE') {
      return {
        success: false,
        error: 'Could not understand the voice command',
        extracted: extracted,
        result: null
      };
    }

    // Step 2: Execute appropriate database action based on the extracted action
    let result;
    let voiceResponse;
    
    switch (extracted.action) {
      case 'CREATE':
        result = await saveOrder(extracted);
        if (result) {
          console.log(`\n➕ CREATE: New order created - ${result.item} x${result.quantity}`);
          console.log(`   Status: ${result.status}`);
          console.log(`   Order ID: ${result.id}`);
          voiceResponse = `Added ${result.quantity} ${result.item} to your order.`;
        }
        break;
        
      case 'DELETE':
        result = await deleteOrder(extracted.item);
        if (result) {
          console.log(`\n🗑️ DELETE: Order cancelled - ${result.item}`);
          console.log(`   Order ID: ${result.id}`);
          voiceResponse = `Cancelled your ${result.item} order.`;
        }
        break;
        
      case 'UPDATE':
        result = await updateOrder(extracted.item, extracted.quantity);
        if (result) {
          console.log(`\n✏️ UPDATE: Order updated - ${result.item} now x${result.quantity}`);
          console.log(`   Order ID: ${result.id}`);
          voiceResponse = `Updated ${result.item} quantity to ${result.quantity}.`;
        }
        break;
        
      case 'TRACK':
        result = await trackOrder(extracted.item);
        if (result) {
          console.log(`\n🔍 TRACK: Order status checked - ${result.item} is ${result.status}`);
          voiceResponse = `Your ${result.item} is currently ${result.status}.`;
        }
        break;
        
      case 'REPLACE':
        result = await replaceOrder(extracted.old_item, extracted.new_item, extracted.quantity);
        if (result) {
          console.log(`\n🔄 REPLACE: Replaced ${result.old_item} with ${result.new_item} x${result.quantity}`);
          console.log(`   Deleted Order ID: ${result.deleted_id}`);
          console.log(`   New Order ID: ${result.new_order.id}`);
          voiceResponse = `Replaced ${result.old_item} with ${result.quantity} ${result.new_item}.`;
        }
        break;
        
      default:
        return {
          success: false,
          error: `Unknown action: ${extracted.action}`,
          extracted: extracted,
          result: null
        };
    }
    
    if (!result) {
      return {
        success: false,
        error: `Failed to execute ${extracted.action} action`,
        extracted: extracted,
        result: null
      };
    }
    
    console.log('------------------------\n');

    return {
      success: true,
      extracted: extracted,
      result: result,
      voiceResponse: voiceResponse
    };

  } catch (error) {
    console.error('Error in processAndSaveVoiceCommand:', error);
    return {
      success: false,
      error: error.message,
      extracted: null,
      result: null
    };
  }
}

/**
 * Delete the most recent pending order for an item (or mark as cancelled)
 * @param {string} item - Item name to find and delete
 * @returns {Promise<Object>} - Deleted order or null if not found/failed
 */
async function deleteOrder(item) {
  try {
    if (!item) {
      console.log('Invalid item for deletion');
      return null;
    }
    
    // Find the most recent pending order for this item
    const { data: orders, error: findError } = await supabase
      .from('orders')
      .select('*')
      .eq('item', item)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(1);
    
    if (findError) {
      console.error('Error finding order to delete:', findError);
      return null;
    }
    
    if (!orders || orders.length === 0) {
      console.log(`No pending order found for item: ${item}`);
      return null;
    }
    
    const orderToDelete = orders[0];
    
    // Option 1: Delete the row
    const { error: deleteError } = await supabase
      .from('orders')
      .delete()
      .eq('id', orderToDelete.id);
    
    if (deleteError) {
      console.error('Error deleting order:', deleteError);
      return null;
    }
    
    return orderToDelete;
    
  } catch (error) {
    console.error('Error in deleteOrder:', error);
    return null;
  }
}

/**
 * Update the quantity of the most recent pending order for an item
 * @param {string} item - Item name to find
 * @param {number} newQuantity - New quantity to set
 * @returns {Promise<Object>} - Updated order or null if not found/failed
 */
async function updateOrder(item, newQuantity) {
  try {
    if (!item || !newQuantity) {
      console.log('Invalid item or quantity for update');
      return null;
    }
    
    // Find the most recent pending order for this item
    const { data: orders, error: findError } = await supabase
      .from('orders')
      .select('*')
      .eq('item', item)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(1);
    
    if (findError) {
      console.error('Error finding order to update:', findError);
      return null;
    }
    
    if (!orders || orders.length === 0) {
      console.log(`No pending order found for item: ${item}`);
      return null;
    }
    
    const orderToUpdate = orders[0];
    
    // Update the quantity
    const { data, error: updateError } = await supabase
      .from('orders')
      .update({ quantity: newQuantity, updated_at: new Date().toISOString() })
      .eq('id', orderToUpdate.id)
      .select()
      .single();
    
    if (updateError) {
      console.error('Error updating order:', updateError);
      return null;
    }
    
    return data;
    
  } catch (error) {
    console.error('Error in updateOrder:', error);
    return null;
  }
}

/**
 * Replace an order: delete old item and create new item
 * @param {string} oldItem - Item to replace
 * @param {string} newItem - New replacement item
 * @param {number} quantity - Quantity for new item
 * @returns {Promise<Object>} - Result with deleted and new order info
 */
async function replaceOrder(oldItem, newItem, quantity) {
  try {
    if (!oldItem || !newItem) {
      console.log('Invalid items for replace:', { oldItem, newItem });
      return null;
    }
    
    // Step 1: Find and delete the most recent pending order for oldItem
    const { data: orders, error: findError } = await supabase
      .from('orders')
      .select('*')
      .eq('item', oldItem)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(1);
    
    if (findError) {
      console.error('Error finding order to replace:', findError);
      return null;
    }
    
    if (!orders || orders.length === 0) {
      console.log(`No pending order found for item to replace: ${oldItem}`);
      return null;
    }
    
    const orderToDelete = orders[0];
    const deletedId = orderToDelete.id;
    
    // Step 2: Delete the old order
    const { error: deleteError } = await supabase
      .from('orders')
      .delete()
      .eq('id', deletedId);
    
    if (deleteError) {
      console.error('Error deleting old order:', deleteError);
      return null;
    }
    
    // Step 3: Create new order for replacement item
    const { data: newOrder, error: insertError } = await supabase
      .from('orders')
      .insert([{
        item: newItem,
        quantity: quantity || 1,
        price: 0.0,
        status: 'pending'
      }])
      .select()
      .single();
    
    if (insertError) {
      console.error('Error creating replacement order:', insertError);
      return null;
    }
    
    return {
      old_item: oldItem,
      new_item: newItem,
      quantity: quantity || 1,
      deleted_id: deletedId,
      new_order: newOrder
    };
    
  } catch (error) {
    console.error('Error in replaceOrder:', error);
    return null;
  }
}

/**
 * Track the status of orders for an item
 * @param {string} item - Item name to track
 * @returns {Promise<Object>} - Order status info or null if not found
 */
async function trackOrder(item) {
  try {
    if (!item) {
      console.log('Invalid item for tracking');
      return null;
    }
    
    // Find orders for this item (any status)
    const { data: orders, error: findError } = await supabase
      .from('orders')
      .select('*')
      .eq('item', item)
      .order('created_at', { ascending: false })
      .limit(1);
    
    if (findError) {
      console.error('Error finding order to track:', findError);
      return null;
    }
    
    if (!orders || orders.length === 0) {
      console.log(`No order found for item: ${item}`);
      return null;
    }
    
    return orders[0];
    
  } catch (error) {
    console.error('Error in trackOrder:', error);
    return null;
  }
}

module.exports = {
  processExecutiveBrain,
  saveOrder,
  processAndSaveVoiceCommand
};

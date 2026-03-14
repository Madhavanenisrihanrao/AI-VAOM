const { GoogleGenerativeAI } = require('@google/generative-ai');
const supabase = require('./db');
require('dotenv').config();

// Initialize Gemini 1.5 Flash
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

/**
 * Process voice command using Gemini AI to extract item, quantity, and action
 * @param {string} text - Voice command text
 * @returns {Promise<Object>} - Extracted {item, quantity, action} or null if failed
 */
async function processVoiceCommand(text) {
  try {
    const prompt = `
You are a semantic intent engine. Extract the action (CREATE, DELETE, UPDATE, TRACK) and the item from natural language commands.

INTENT MAPPING - Understand synonyms and context:
- CREATE: "order", "add", "get", "buy", "want", "need", "craving", "grab", "fetch"
- DELETE: "cancel", "remove", "delete", "drop", "scrap", "trash", "get rid of"
- UPDATE: "change", "modify", "update", "make it", "switch to", "alter", "edit"
- TRACK: "check", "track", "how is my", "where is", "status of", "what about"

SEMANTIC ITEM UNDERSTANDING - Identify items even when described vaguely:
- "caffeine fix" → coffee
- "morning joe" → coffee
- "liquid energy" → coffee
- "round Italian dough with cheese" → pizza
- "juicy beef patty in a bun" → burger
- "cold bubbly refreshment" → soda

Return ONLY a valid JSON object in this exact format:
For CREATE/DELETE/UPDATE/TRACK: {"action": "ACTION_NAME", "item": "item_name", "quantity": number}
For REPLACE: {"action": "REPLACE", "old_item": "item_to_replace", "new_item": "replacement_item", "quantity": number}

Rules:
- Action must be one of: CREATE, DELETE, UPDATE, TRACK, REPLACE
- For REPLACE: extract both old_item (being replaced) and new_item (replacement)
- Item name should be lowercase and singular
- If quantity is not specified, default to 1
- If truly no item can be identified, return {"action": "IGNORE", "item": null, "quantity": null}
- Return ONLY the JSON object, no other text or explanation

Text to parse: "${text}"
`;

    const result = await model.generateContent(prompt);
    const response = result.response;
    const textResponse = response.text();

    // Extract JSON from response (handle potential markdown code blocks)
    let jsonStr = textResponse.trim();
    
    // Remove markdown code block if present
    if (jsonStr.startsWith('```json')) {
      jsonStr = jsonStr.replace(/```json\n?/, '').replace(/```$/, '');
    } else if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/```\n?/, '').replace(/```$/, '');
    }
    
    jsonStr = jsonStr.trim();

    // Parse the JSON response
    const parsed = JSON.parse(jsonStr);
    
    // Validate the response structure
    if (!parsed.action) {
      console.log('AI returned no action:', parsed);
      return { action: 'ERROR', error: 'Invalid AI response', item: null, quantity: null };
    }

    // Handle ERROR action from AI
    if (parsed.action === 'ERROR') {
      return parsed;
    }
    
    // 🧠 Gemini Reasoning Log
    console.log(`\n🧠 Gemini Reasoning: [${parsed.action}] Intent identified. Item: "${parsed.item || parsed.old_item || 'none'}"`);

    // Handle REPLACE action specially
    if (parsed.action === 'REPLACE') {
      if (!parsed.old_item || !parsed.new_item) {
        console.log('AI returned REPLACE without old_item or new_item:', parsed);
        return null;
      }
      return {
        action: parsed.action,
        old_item: parsed.old_item.toLowerCase(),
        new_item: parsed.new_item.toLowerCase(),
        item: parsed.new_item.toLowerCase(), // For compatibility
        quantity: typeof parsed.quantity === 'number' ? parsed.quantity : 1
      };
    }

    // If it's a CREATE/UPDATE action but no item, that's invalid
    if ((parsed.action === 'CREATE' || parsed.action === 'UPDATE') && !parsed.item) {
      console.log('AI returned action without item:', parsed);
      return null;
    }

    return {
      action: parsed.action,
      item: parsed.item ? parsed.item.toLowerCase() : null,
      quantity: typeof parsed.quantity === 'number' ? parsed.quantity : 1
    };

  } catch (error) {
    console.error('Error processing voice command with Gemini:', error);
    return {
      action: 'ERROR',
      error: 'AI processing failed. Please try again.',
      item: null,
      quantity: null
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
  processVoiceCommand,
  saveOrder,
  processAndSaveVoiceCommand
};

require('dotenv').config();
const express = require('express');
const { Telegraf, Markup } = require('telegraf');
const { createClient } = require('@supabase/supabase-js');
const vision = require('@google-cloud/vision');
const path = require('path');
const fs = require('fs');
const fetch = require('node-fetch'); // npm i node-fetch@2

// Initialize bot and services
const bot = new Telegraf(process.env.BOT_TOKEN);
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const visionClient = new vision.ImageAnnotatorClient({
  keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
});

const sessions = new Map();

const categories = [
  { name: "Entertainment", type: "expense" },
  { name: "Side Hustle", type: "income" },
  { name: "Personal Care", type: "expense" },
  { name: "Food & Dining", type: "expense" },
  { name: "Gifts & Donations", type: "expense" },
  { name: "Groceries", type: "expense" },
  { name: "Subscriptions", type: "expense" },
  { name: "Shopping", type: "expense" },
  { name: "Emergency Fund", type: "saving" },
  { name: "Business", type: "income" },
  { name: "Rent/Mortgage", type: "expense" },
  { name: "Education Fund", type: "saving" },
  { name: "Fuel", type: "expense" },
  { name: "Vacation Fund", type: "saving" },
  { name: "Health & Medical", type: "expense" },
  { name: "Insurance", type: "expense" },
  { name: "Other Income", type: "income" },
  { name: "Other Expenses", type: "expense" },
  { name: "Freelance", type: "income" },
  { name: "Investment", type: "saving" },
  { name: "Retirement", type: "saving" },
  { name: "Transportation", type: "expense" },
  { name: "Utilities", type: "expense" },
  { name: "Salary", type: "income" },
];

// Keyboards

const getMainMenuKeyboard = () => {
  return Markup.inlineKeyboard([
    [Markup.button.callback('💸 New Transaction', 'new_transaction')],
    [Markup.button.callback('📊 View Summary', 'view_summary')],
    [Markup.button.callback('📈 Analytics', 'analytics')],
    [Markup.button.callback('⚙️ Settings', 'settings')],
  ]);
};

const getTransactionMethodKeyboard = () => {
  return Markup.inlineKeyboard([
    [Markup.button.callback('✍️ Manual Entry', 'method_manual')],
    [Markup.button.callback('📷 Photo Entry', 'method_photo')],
    [Markup.button.callback('🔙 Back to Menu', 'back_to_menu')],
  ]);
};

const getPostSaveKeyboard = () => {
  return Markup.inlineKeyboard([
    [Markup.button.callback('➕ Add Another Transaction', 'new_transaction')],
    [Markup.button.callback('🏠 Back to Main Menu', 'back_to_menu')],
  ]);
};

const getTypeKeyboard = () => {
  return Markup.inlineKeyboard([
    [Markup.button.callback('💸 Expense', 'type_expense')],
    [Markup.button.callback('💰 Income', 'type_income')],
    [Markup.button.callback('🏦 Saving', 'type_saving')],
    [Markup.button.callback('🔙 Back', 'back_to_method')],
  ]);
};

const getCategoryKeyboard = (type) => {
  const filtered = categories.filter(c => c.type === type);
  const keyboard = filtered.map(cat => [Markup.button.callback(cat.name, `category_${cat.name}`)]);
  keyboard.push([Markup.button.callback('🔙 Back', 'back_to_type')]);
  return Markup.inlineKeyboard(keyboard);
};

// Bot logic

bot.start((ctx) => {
  const welcomeMessage = `🌟 Welcome to Finance Tracker Bot!

📱 Your personal finance assistant to track expenses, income, and savings.

Choose an option below to get started:`;

  ctx.reply(welcomeMessage, getMainMenuKeyboard());
});

bot.command('menu', (ctx) => {
  ctx.reply('🏠 Main Menu', getMainMenuKeyboard());
});

bot.action('new_transaction', (ctx) => {
  sessions.set(ctx.from.id, {});
  ctx.editMessageText('Select input method:', getTransactionMethodKeyboard());
});

bot.action('back_to_menu', (ctx) => {
  ctx.editMessageText('🏠 Main Menu', getMainMenuKeyboard());
});

bot.action('method_manual', (ctx) => {
  const session = sessions.get(ctx.from.id) || {};
  session.method = 'manual';
  sessions.set(ctx.from.id, session);
  ctx.editMessageText('Select transaction type:', getTypeKeyboard());
});

bot.action('method_photo', (ctx) => {
  const session = sessions.get(ctx.from.id) || {};
  session.method = 'photo';
  sessions.set(ctx.from.id, session);
  ctx.editMessageText('Send a photo of your receipt or transaction document.');
});

bot.action('back_to_method', (ctx) => {
  ctx.editMessageText('Select input method:', getTransactionMethodKeyboard());
});

bot.action(/type_(expense|income|saving)/, (ctx) => {
  const type = ctx.match[1];
  const session = sessions.get(ctx.from.id) || {};
  session.type = type;
  sessions.set(ctx.from.id, session);
  ctx.editMessageText('Select a category:', getCategoryKeyboard(type));
});

bot.action('back_to_type', (ctx) => {
  ctx.editMessageText('Select transaction type:', getTypeKeyboard());
});

bot.action(/category_(.+)/, (ctx) => {
  const categoryName = ctx.match[1];
  const session = sessions.get(ctx.from.id) || {};
  session.category = categoryName;
  sessions.set(ctx.from.id, session);

  if (session.method === 'manual') {
    ctx.editMessageText(`Enter the amount for ${categoryName}:`);
  } else {
    ctx.editMessageText('Please send the photo now.');
  }
});

// Photo handler for photo input method
bot.on('photo', async (ctx) => {
  const session = sessions.get(ctx.from.id);
  if (!session || session.method !== 'photo') {
    return ctx.reply('Please choose photo input method first by clicking "New Transaction".');
  }

  try {
    const photoArray = ctx.message.photo;
    const fileId = photoArray[photoArray.length - 1].file_id; // highest res
    const fileLink = await ctx.telegram.getFileLink(fileId);

    // Download photo as buffer
    const response = await fetch(fileLink.href);
    const buffer = await response.buffer();

    // Save temporarily to local disk (necessary for Google Vision API)
    const tempImagePath = path.join(__dirname, `temp_${ctx.from.id}.jpg`);
    fs.writeFileSync(tempImagePath, buffer);

    // Use Google Vision to extract text
    const [result] = await visionClient.textDetection(tempImagePath);
    fs.unlinkSync(tempImagePath); // delete temp image

    const detections = result.textAnnotations;
    if (!detections || detections.length === 0) {
      return ctx.reply('Could not detect any text in the photo. Please try again or enter manually.');
    }

    // Extract text and parse amount (simple regex)
    const text = detections[0].description;
    const amountMatch = text.match(/(\d+(\.\d{1,2})?)/);
    if (!amountMatch) {
      return ctx.reply('Could not find an amount in the photo text. Please enter manually.');
    }

    const amount = parseFloat(amountMatch[1]);
    if (isNaN(amount)) {
      return ctx.reply('Amount detected is not valid. Please enter manually.');
    }

    session.amount = amount;
    sessions.set(ctx.from.id, session);

    // Ask for transaction type and category after amount detected
    await ctx.reply(`Detected amount: ${amount}\nNow select transaction type:`, getTypeKeyboard());

  } catch (error) {
    console.error(error);
    ctx.reply('Error processing the photo. Please try again.');
  }
});

// Text handler for manual amount input and other texts
bot.on('text', async (ctx) => {
  const session = sessions.get(ctx.from.id);
  if (!session) {
    return ctx.reply('Please start a new transaction by clicking "New Transaction".');
  }

  // If manual method and category is selected but amount not yet entered
  if (session.method === 'manual' && session.category && !session.amount) {
    const amountStr = ctx.message.text.trim();
    const amount = parseFloat(amountStr);

    if (isNaN(amount) || amount <= 0) {
      return ctx.reply('Please enter a valid positive amount.');
    }

    session.amount = amount;
    sessions.set(ctx.from.id, session);

    // Save to DB
    await saveTransaction(ctx.from.id, session, ctx);
    return;
  }

  // If no session or step mismatch
  ctx.reply('Please follow the menu options or type /menu.');
});

// Function to save transaction in Supabase
async function saveTransaction(userId, session, ctx) {
  try {
    const { amount, category, type } = session;
    if (!amount || !category || !type) {
      return ctx.reply('Missing information. Please start again.');
    }

    const { data, error } = await supabase
      .from('transactions')
      .insert([{ user_id: userId, amount, category, type, created_at: new Date().toISOString() }]);

    if (error) {
      console.error('Supabase insert error:', error);
      return ctx.reply('Failed to save transaction. Please try again later.');
    }

    sessions.delete(userId);
    ctx.reply(`Transaction saved successfully:
Amount: ${amount}
Category: ${category}
Type: ${type}`, getPostSaveKeyboard());

  } catch (err) {
    console.error('saveTransaction error:', err);
    ctx.reply('An error occurred while saving your transaction.');
  }
}

// Placeholder for other menu actions
bot.action('view_summary', (ctx) => {
  ctx.editMessageText('Summary feature coming soon! 🛠️');
});

bot.action('analytics', (ctx) => {
  ctx.editMessageText('Analytics feature coming soon! 📊');
});

bot.action('settings', (ctx) => {
  ctx.editMessageText('Settings feature coming soon! ⚙️');
});

// =============== WEBHOOK SETUP ===============

const app = express();

const PORT = process.env.PORT || 3000;
const WEBHOOK_PATH = `/bot${process.env.BOT_TOKEN}`;
const WEBHOOK_URL = process.env.WEBHOOK_URL || `https://your-render-service.onrender.com${WEBHOOK_PATH}`;

(async () => {
  try {
    await bot.telegram.setWebhook(WEBHOOK_URL);
    console.log(`Webhook set to: ${WEBHOOK_URL}`);
  } catch (err) {
    console.error('Failed to set webhook:', err);
  }
})();

app.use(bot.webhookCallback(WEBHOOK_PATH));

app.get('/', (req, res) => {
  res.send('Finance Tracker Bot is running!');
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});

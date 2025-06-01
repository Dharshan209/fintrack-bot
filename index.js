require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const { createClient } = require('@supabase/supabase-js');
const vision = require('@google-cloud/vision');
const path = require('path');
const fs = require('fs');
const fetch = require('node-fetch'); // install with npm i node-fetch@2

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

// /start command
bot.start((ctx) => {
  const welcomeMessage = `🌟 Welcome to Finance Tracker Bot!

📱 Your personal finance assistant to track expenses, income, and savings.

Choose an option below to get started:`;

  ctx.reply(welcomeMessage, getMainMenuKeyboard());
});

bot.command('menu', (ctx) => {
  ctx.reply('🏠 Main Menu', getMainMenuKeyboard());
});

// Main menu actions
bot.action('new_transaction', (ctx) => {
  sessions.set(ctx.from.id, { step: 'method' });
  ctx.answerCbQuery();
  ctx.reply('💳 New Transaction\n\nHow would you like to add your transaction?', getTransactionMethodKeyboard());
});

bot.action('view_summary', (ctx) => {
  ctx.answerCbQuery();
  ctx.reply('📊 Feature coming soon! This will show your spending summary.', 
    Markup.inlineKeyboard([[Markup.button.callback('🔙 Back to Menu', 'back_to_menu')]]));
});

bot.action('analytics', (ctx) => {
  ctx.answerCbQuery();
  ctx.reply('📈 Feature coming soon! This will show detailed analytics.', 
    Markup.inlineKeyboard([[Markup.button.callback('🔙 Back to Menu', 'back_to_menu')]]));
});

bot.action('settings', (ctx) => {
  ctx.answerCbQuery();
  ctx.reply('⚙️ Feature coming soon! This will allow you to customize settings.', 
    Markup.inlineKeyboard([[Markup.button.callback('🔙 Back to Menu', 'back_to_menu')]]));
});

// Transaction method selection
bot.action('method_manual', (ctx) => {
  const session = sessions.get(ctx.from.id);
  if (!session) return ctx.reply('❌ Session expired. Please start again.', getMainMenuKeyboard());

  session.method = 'manual';
  session.step = 'type';

  ctx.answerCbQuery();
  ctx.reply('✍️ Manual Entry\n\nWhat type of transaction is this?', getTypeKeyboard());
});

bot.action('method_photo', (ctx) => {
  const session = sessions.get(ctx.from.id) || {};
  session.method = 'photo';
  session.step = 'photo_upload';
  sessions.set(ctx.from.id, session);

  ctx.answerCbQuery();
  ctx.reply('📷 Please upload a photo of your bill or receipt.');
});

// Handle photo uploads
bot.on('photo', async (ctx) => {
  const userId = ctx.from.id;
  const session = sessions.get(userId);

  if (!session || session.method !== 'photo' || session.step !== 'photo_upload') {
    return ctx.reply('❌ Please select "Photo Entry" method first from the menu.');
  }

  try {
    const photo = ctx.message.photo.pop(); // highest res photo
    const fileId = photo.file_id;
    const fileLink = await ctx.telegram.getFileLink(fileId);

    // Download the image file
    const res = await fetch(fileLink.href);
    const buffer = await res.buffer();
    const tempImagePath = path.join(__dirname, `temp-${userId}.jpg`);
    fs.writeFileSync(tempImagePath, buffer);

    // Use Vision API to detect text
    const [result] = await visionClient.textDetection(tempImagePath);
    const detections = result.textAnnotations;
    fs.unlinkSync(tempImagePath); // remove temp file

    if (!detections.length) {
      return ctx.reply('❌ No readable text found in the image. Please try again or use manual entry.');
    }

    const fullText = detections[0].description;
    console.log('Extracted Text:', fullText);

    // Extract amount using regex (₹ or Rs optional)
    const amountMatch = fullText.match(/(?:Rs|₹)?\s?(\d+(?:\.\d{1,2})?)/i);
    const amount = amountMatch ? parseFloat(amountMatch[1]) : null;

    if (!amount) {
      return ctx.reply('❌ Could not extract amount from the image. Please try again or enter manually.');
    }

    // Save to session
    session.amount = amount;
    session.description = fullText.trim();
    session.step = 'type';

    await ctx.reply(`🧾 Detected Amount: ₹${amount}\n\n📝 Text:\n${fullText}\n\nWhat type of transaction is this?`, getTypeKeyboard());
  } catch (error) {
    console.error('Error processing photo:', error);
    ctx.reply('❌ Error processing the image. Please try again or use manual entry.');
  }
});

// Back navigation
bot.action('back_to_menu', (ctx) => {
  sessions.delete(ctx.from.id);
  ctx.answerCbQuery();
  ctx.reply('🏠 Main Menu', getMainMenuKeyboard());
});

bot.action('back_to_method', (ctx) => {
  const session = sessions.get(ctx.from.id);
  if (session) {
    session.step = 'method';
    delete session.type;
  }
  ctx.answerCbQuery();
  ctx.reply('💳 New Transaction\n\nHow would you like to add your transaction?', getTransactionMethodKeyboard());
});

bot.action('back_to_type', (ctx) => {
  const session = sessions.get(ctx.from.id);
  if (session) {
    session.step = 'type';
    delete session.category_name;
  }
  ctx.answerCbQuery();
  ctx.reply('✍️ Manual Entry\n\nWhat type of transaction is this?', getTypeKeyboard());
});

// Type selection
bot.action(/type_(.+)/, async (ctx) => {
  const type = ctx.match[1];
  const userId = ctx.from.id;
  const session = sessions.get(userId);
  if (!session) return ctx.reply('❌ Session expired. Please start again.', getMainMenuKeyboard());

  session.type = type;
  session.step = 'category';

  const typeEmoji = type === 'expense' ? '💸' : type === 'income' ? '💰' : '🏦';
  const typeText = type.charAt(0).toUpperCase() + type.slice(1);

  await ctx.answerCbQuery();
  ctx.reply(`${typeEmoji} ${typeText} Transaction\n\nChoose a category:`, getCategoryKeyboard(type));
});

// Category selection
bot.action(/category_(.+)/, async (ctx) => {
  const categoryName = ctx.match[1];
  const userId = ctx.from.id;
  const session = sessions.get(userId);
  if (!session) return ctx.reply('❌ Session expired. Please start again.', getMainMenuKeyboard());

  session.category_name = categoryName;
  session.step = 'amount';

  await ctx.answerCbQuery();

  // If amount already known (photo method), skip amount input
  if (session.amount) {
    session.step = 'description';

    const cancelKeyboard = Markup.inlineKeyboard([
      [Markup.button.callback('⏭️ Skip Description', 'skip_description')],
      [Markup.button.callback('🔙 Back', 'back_to_category')],
    ]);

    return ctx.reply(
      `💵 Amount detected: ₹${session.amount}\n\nYou can add a description or skip:`,
      cancelKeyboard
    );
  }

  ctx.reply('💵 Please enter the amount (numbers only):');
});

// Back to category selection from description step
bot.action('back_to_category', (ctx) => {
  const session = sessions.get(ctx.from.id);
  if (session) {
    session.step = 'category';
    delete session.category_name;
  }
  ctx.answerCbQuery();
  ctx.reply('Choose a category:', getCategoryKeyboard(session.type || 'expense'));
});

// Skip description
bot.action('skip_description', (ctx) => {
  const session = sessions.get(ctx.from.id);
  if (!session) return ctx.reply('❌ Session expired. Please start again.', getMainMenuKeyboard());

  session.description = '';
  session.step = 'save';

  ctx.answerCbQuery();
  ctx.reply('Saving your transaction...');
  saveTransaction(ctx, session);
});

// Text input handler
bot.on('text', async (ctx) => {
  const userId = ctx.from.id;
  const session = sessions.get(userId);
  if (!session) return;

  const text = ctx.message.text;

  if (session.step === 'amount') {
    // Validate amount input
    const amount = parseFloat(text);
    if (isNaN(amount) || amount <= 0) {
      return ctx.reply('❌ Invalid amount. Please enter a valid positive number:');
    }
    session.amount = amount;
    session.step = 'description';

    const cancelKeyboard = Markup.inlineKeyboard([
      [Markup.button.callback('⏭️ Skip Description', 'skip_description')],
      [Markup.button.callback('🔙 Back', 'back_to_category')],
    ]);

    return ctx.reply('📝 Enter a description or note for this transaction (optional):', cancelKeyboard);
  }

  if (session.step === 'description') {
    session.description = text;
    session.step = 'save';

    ctx.reply('Saving your transaction...');
    return saveTransaction(ctx, session);
  }
});

// Save transaction to Supabase
async function saveTransaction(ctx, session) {
  try {
    const userId = ctx.from.id;

    const { data, error } = await supabase.from('transactions').insert({
      user_id: userId,
      type: session.type,
      category_name: session.category_name,
      amount: session.amount,
      description: session.description || '',
      created_at: new Date().toISOString(),
    });

    if (error) {
      console.error('Supabase insert error:', error);
      return ctx.reply('❌ Error saving transaction. Please try again.');
    }

    sessions.delete(userId);

    ctx.reply('✅ Transaction saved successfully!', getPostSaveKeyboard());
  } catch (error) {
    console.error('Save transaction error:', error);
    ctx.reply('❌ Unexpected error. Please try again.');
  }
}

bot.launch();
console.log('Bot started');

// Graceful shutdown
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

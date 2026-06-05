const Anthropic = require('@anthropic-ai/sdk');
require('dotenv').config();

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const BILL_SYSTEM_PROMPT = `You are an AI assistant helping Indian store owners track inventory.
You will receive a photo of a supplier delivery bill or invoice.
The bill may be handwritten or printed.
The bill may be in English, Hindi, Telugu, or a mix of these languages.
Your job is to extract ALL line items from the bill.
For each item extract:
  - product_name: the name of the product (translate to English if in another language)
  - original_name: the name exactly as written on the bill
  - quantity: numeric quantity (convert from Hindi/Telugu numerals if needed)
  - unit: the unit of measurement (bags, kg, pieces, metres, litres, etc)
  - unit_price: price per unit if visible (optional)
  - total_price: total price for this line if visible (optional)
Also extract if visible:
  - supplier_name: name of the supplier/company
  - bill_date: date on the bill
  - bill_total: grand total amount
Return ONLY a valid JSON object. No explanation, no markdown, no preamble.
Format: { supplier_name, bill_date, bill_total, items: [{product_name, original_name, quantity, unit, unit_price, total_price}] }
If you cannot read a value clearly, use null for that field.
Never guess quantities — if unclear, use null.`;

/**
 * Parse a bill image using Claude Vision.
 * @param {string} base64Image - base64 encoded image
 * @param {string} mediaType - e.g. 'image/jpeg'
 * @returns {object} parsed bill data
 */
async function parseBillImage(base64Image, mediaType = 'image/jpeg') {
  const message = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    system: BILL_SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: mediaType,
              data: base64Image,
            },
          },
          {
            type: 'text',
            text: 'Parse this bill and return the JSON.',
          },
        ],
      },
    ],
  });

  const raw = message.content[0].text.trim();

  try {
    return JSON.parse(raw);
  } catch {
    // Try to extract JSON if there's any surrounding text
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error('Claude returned non-JSON response: ' + raw.slice(0, 200));
  }
}

/**
 * Parse a stock OUT command using Claude.
 * Useful for ambiguous or complex text commands.
 */
async function parseStockOutText(text, products) {
  const productList = products.map((p) => `${p.name} (${p.unit})`).join(', ');

  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 256,
    messages: [
      {
        role: 'user',
        content: `Store's products: ${productList}

Owner message: "${text}"

Extract stock out details. Return ONLY valid JSON:
{"product_name": "...", "quantity": <number>, "customer_name": "..." or null}

If no clear product or quantity found, return {"product_name": null, "quantity": null, "customer_name": null}`,
      },
    ],
  });

  const raw = message.content[0].text.trim();
  try {
    return JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    return { product_name: null, quantity: null, customer_name: null };
  }
}

module.exports = { parseBillImage, parseStockOutText };

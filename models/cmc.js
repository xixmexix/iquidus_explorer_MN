var mongoose = require('mongoose')
  , Schema = mongoose.Schema;

var CmcSchema = new Schema({
  symbol: { type: String },
  rank: { type: String },
  price_usd: { type: String },
  price_btc: { type: String },
  volume_24h_usd: { type: String },
  market_cap_usd: { type: String },
  available_supply: { type: String },
  total_supply: { type: String },
  percent_change_1h: { type: String },
  percent_change_24h: { type: String },
  percent_change_7d: { type: String },
  last_updated: { type: Number }
});

module.exports = mongoose.model('cmcs', CmcSchema);

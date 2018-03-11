var mongoose = require('mongoose')
  , db = require('../lib/database')
  , Tx = require('../models/tx')  
  , Address = require('../models/address')  
  , Richlist = require('../models/richlist')  
  , Stats = require('../models/stats')
  , MasternodeStats = require('../models/masternodeStats')
  , explorer = require('../lib/explorer')
  , settings = require('../lib/settings')
  , fs = require('fs')
  , BigNumber = require('bignumber.js')
;

var mode = 'update';
var database = 'index';

// displays usage and exits
function usage() {
  console.log('Usage: node scripts/sync.js [database] [mode]');
  console.log('');
  console.log('database: (required)');
  console.log('index [mode] Main index: coin info/stats, transactions & addresses');
  console.log('market       Market data: summaries, orderbooks, trade history & chartdata')
  console.log('');
  console.log('mode: (required for index database only)');
  console.log('update       Updates index from last sync to current block');
  console.log('check        checks index for (and adds) any missing transactions/addresses');
  console.log('reindex      Clears index then resyncs from genesis to current block');
  console.log('');
  console.log('notes:'); 
  console.log('* \'current block\' is the latest created block when script is executed.');
  console.log('* The market database only supports (& defaults to) reindex mode.');
  console.log('* If check mode finds missing data(ignoring new data since last sync),'); 
  console.log('  index_timeout in settings.json is set too low.')
  console.log('');
  process.exit(0);
}

// check options
if (process.argv[2] == 'index') {
  if (process.argv.length <3) {
    usage();
  } else {
    switch(process.argv[3])
    {
    case 'update':
      mode = 'update';
      break;
    case 'check':
      mode = 'check';
      break;
    case 'reindex':
      mode = 'reindex';
      break;
    default:
      usage();
    }
  }
} else if (process.argv[2] == 'market'){
  database = 'market';
} else if (process.argv[2] === 'cmc'){
  database = 'cmc';
} else if (process.argv[2] === 'mnstats'){
  database = 'mnstats';
} else {
  usage();
}

function create_lock(cb) {
  if ( database == 'index' ) {
    var fname = './tmp/' + database + '.pid';
    fs.appendFile(fname, process.pid, function (err) {
      if (err) {
        console.log("Error: unable to create %s", fname);
        process.exit(1);
      } else {
        return cb();
      }
    });
  } else {
    return cb();
  }
}

function remove_lock(cb) {
  if ( database == 'index' ) {
    var fname = './tmp/' + database + '.pid';
    fs.unlink(fname, function (err){
      if(err) {
        console.log("unable to remove lock: %s", fname);
        process.exit(1);
      } else {
        return cb();
      }
    });
  } else {
    return cb();
  }  
}

function is_locked(cb) {
  if ( database == 'index' ) {
    var fname = './tmp/' + database + '.pid';
    fs.exists(fname, function (exists){
      if(exists) {
        return cb(true);
      } else {
        return cb(false);
      }
    });
  } else {
    return cb();
  } 
}

function exit() {
  remove_lock(function(){
    mongoose.disconnect();
    process.exit(0);
  });
}

var dbString = 'mongodb://' + settings.dbsettings.user;
dbString = dbString + ':' + settings.dbsettings.password;
dbString = dbString + '@' + settings.dbsettings.address;
dbString = dbString + ':' + settings.dbsettings.port;
dbString = dbString + '/' + settings.dbsettings.database;

is_locked(function (exists) {
  if (exists) {
    console.log("Script already running..");
    process.exit(0);
  } else {
    create_lock(function (){
      console.log("script launched with pid: " + process.pid);
      mongoose.connect(dbString, function(err) {
        if (err) {
          console.log('Unable to connect to database: %s', dbString);
          console.log('Aborting');
          exit();
        } else if (database == 'index') {
          db.check_stats(settings.coin, function(exists) {
            if (exists == false) {
              console.log('Run \'npm start\' to create database structures before running this script.');
              exit();
            } else {
              db.update_db(settings.coin, function(){
                db.get_stats(settings.coin, function(stats){
                  if (settings.heavy == true) {
                    db.update_heavy(settings.coin, stats.count, 20, function(){
                    
                    });
                  }
                  if (mode == 'reindex') {
                    Tx.remove({}, function(err) { 
                      Address.remove({}, function(err2) { 
                        Richlist.update({coin: settings.coin}, {
                          received: [],
                          balance: [],
                        }, function(err3) { 
                          Stats.update({coin: settings.coin}, { 
                            last: 0,
                          }, function() {
                            console.log('index cleared (reindex)');
                          }); 
                          db.update_tx_db(settings.coin, 1, stats.count, settings.update_timeout, function(){
                            db.update_richlist('received', function(){
                              db.update_richlist('balance', function(){
                                db.get_stats(settings.coin, function(nstats){
                                  console.log('reindex complete (block: %s)', nstats.last);
                                  exit();
                                });
                              });
                            });
                          });
                        });
                      });
                    });              
                  } else if (mode == 'check') {
                    db.update_tx_db(settings.coin, 1, stats.count, settings.check_timeout, function(){
                      db.get_stats(settings.coin, function(nstats){
                        console.log('check complete (block: %s)', nstats.last);
                        exit();
                      });
                    });
                  } else if (mode == 'update') {
                    db.update_tx_db(settings.coin, stats.last, stats.count, settings.update_timeout, function(){
                      db.update_richlist('received', function(){
                        db.update_richlist('balance', function(){
                          db.get_stats(settings.coin, function(nstats){
                            console.log('update complete (block: %s)', nstats.last);
                            exit();
                          });
                        });
                      });
                    });
                  }
                });
              });
            }
          });
        } else if (database === 'cmc') {
          // update CoinMarketCap
          console.log("Updating CoinMarketCap data...");
          db.check_cmc(settings.coinmarketcap.ticker, function(exists) {
            if (exists === false) {
              console.log('Run \'npm start\' to create database structures before running this script.');
              exit();
            }

            db.update_coinmarketcap_db(settings.coinmarketcap.ticker, function (err) {
              if (err === true) {
                console.log('ERROR: %s: %s', settings.coinmarketcap.ticker, err);
              }
              else {
                console.log('  CoinMarketCap for ticker %s updated successfully.', settings.coinmarketcap.ticker);
              }

              exit();
            });

          })
        } else if (database === 'mnstats') {
          console.log("Updating Masternode Stats...\n");

          db.check_cmc(settings.coinmarketcap.ticker, function(exists) {
            if (exists === false) {
              console.log('Run \'npm start\' and sync cmc data before running this script.');
              exit();
            }

            db.get_cmc(settings.coinmarketcap.ticker, function (cmc) {

              var tsNow = Math.round(new Date().getTime() / 1000);
              var ts24h = tsNow - (24 * 3600);
              explorer.get_masternodelist(function (mnList) {
                var mnPayees = [];
                var mnPayeeIdx = settings.masternodes.list_format.address;
                for (key in mnList) {
                  if (!mnList.hasOwnProperty(key)) {
                    continue;
                  }

                  if (settings.baseType === 'pivx') {
                    mnPayees.push(mnList[key].addr);
                  } else {
                    var mnPayee = mnList[key].split(/(\s+)/).filter(function (e) {
                      return e.trim().length > 0;
                    })[mnPayeeIdx - 1];
                    mnPayees.push(mnPayee);
                  }

                }

                db.get_masternode_rewards(ts24h, mnPayees, function (mnRewards24h) {
                  db.get_block_count(ts24h, function(blockCount24h) {
                    explorer.get_masternodecount(function (mnCountTotal) {
                      explorer.get_masternodeonlinecount(function (mnCountEnabled) {
                        var mnReward24h = mnRewards24h / mnPayees.length;
                        var roiDays = settings.coininfo.masternode_required / mnReward24h;
                        var avgBlockTimeSec = Math.round((24*3600) / blockCount24h);

                        console.log('    Data since ts : ', ts24h);
                        console.log('  Blocks last 24h : ', blockCount24h);
                        console.log('  Avg. block time : ', avgBlockTimeSec);
                        console.log('  MN count  total : ', mnCountTotal);
                        console.log('  MN count online : ', mnCountEnabled);
                        console.log('  MNs rewards 24h : ', mnRewards24h);
                        console.log('  MN  rewards 24h : ', mnReward24h);
                        console.log('  MN     roi days : ', roiDays);
                        console.log('  MN roi % annual : ', (365 / roiDays) * 100);
                        console.log('  Coin price  BTC : ', cmc.price_btc);
                        console.log('  Coin price  USD : ', cmc.price_usd);

                        var nwMnStats = new MasternodeStats({
                          symbol: settings.symbol,
                          block_count_24h: blockCount24h,
                          block_avg_time: avgBlockTimeSec,
                          count_total: mnCountTotal,
                          count_enabled: mnCountEnabled,
                          roi_days: roiDays,
                          reward_coins_24h: mnReward24h,
                          price_btc: cmc.price_btc,
                          price_usd: cmc.price_usd
                        });

                        nwMnStats.save(function (err, o) {
                          if (err) {
                            console.log('Failed to store the Masternode Stats object.', err);
                          } else {
                            console.log("Masternode Stats saved successfully.\n");
                          }
                          exit();
                        });
                      });
                    });
                  });
                });
              });
            });




          });



        } else {
          //update markets
          var markets = settings.markets.enabled;
          var complete = 0;
          for (var x = 0; x < markets.length; x++) {
            var market = markets[x];
            db.check_market(market, function(mkt, exists) {
              if (exists) {
                db.update_markets_db(mkt, function(err) {
                  if (!err) {
                    console.log('%s market data updated successfully.', mkt);
                    complete++;
                    if (complete == markets.length) {
                      exit();
                    }
                  } else {
                    console.log('%s: %s', mkt, err);
                    complete++;
                    if (complete == markets.length) {
                      exit();
                    }
                  }
                });
              } else {
                console.log('error: entry for %s does not exists in markets db.', mkt);
                complete++;
                if (complete == markets.length) {
                  exit();
                }
              }
            });
          }
        }
      });
    });
  }
});
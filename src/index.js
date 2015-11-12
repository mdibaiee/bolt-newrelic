import Client from 'newrelic-api';

const FAIL = 'Operation failed :(';

export default bot => {
  let { compare } = bot.utils;

  let client = new Client({
    key: bot.data.newrelic.key
  });

  let APPS = [];
  let ENABLED = [];

  let model = bot.pocket.model('NewrelicApp', {
    name: String,
    id: String
  });


  bot.agenda.define('monitor-newrelic', (job, done) => {
    let { data } = job.attrs;

    model.findOne({ id: data.app.id }).exec().then(enabled => {
      console.log('enabled', enabled);
      let index = ENABLED.findIndex(i => i.id === data.app.id);

      if (!enabled) {
        if (index > -1) {
          ENABLED.splice(index, 1);
        }
        return;
      }
      if (index === -1) {
        ENABLED.push({
          id: data.app.id,
          name: data.app.name
        });
      }

      let { threshold } = bot.data.newrelic;

      console.log('threshold', threshold);
      client.apdex({
        app: data.app.id
      }).then(rate => {
        console.log('apdex', rate);
        if (compare(threshold.apdex, rate)) {
          const msg = `Application ${data.app.name}
                       's apdex score has dropped below threshold!`;

          bot.sendMessage(bot.data.newrelic.target, msg);
        }

        done();
      }).then(() => {
        return client.error({
          app: data.app.id
        }).then(rate => {
          console.log('error', rate);
          if (compare(threshold.error, rate)) {
            const msg = `Application ${data.app.name}
                         's error rating is over threshold!`;

            bot.sendMessage(bot.data.newrelic.target, msg);
          }
        })
      }).then(done);
    });
  });

  bot.agenda.on('ready', () => {
    client.apps().then(apps => {
      APPS = apps;
      console.log('apps', apps);

      let enabled = model.find().exec().then(enabled => {
        ENABLED = enabled;
        if (!enabled.length) {
          return Promise.all(apps.map(app => {
            return bot.pocket.save('NewrelicApp', app);
          }));
        }

        return enabled.map(name => {
          return apps.find(i => i.name === name);
        })
      });

      for (let app of apps) {
        agenda.every('15 minutes', 'monitor-newrelic', { app });
      }
    });

    bot.listen(/newrelic (\w+)\s?(.*)?/i, message => {
      let [, command, arg] = message.match;

      if (command === 'list') {
        const msg = APPS.map((app, index) => {
          let status = ENABLED.find(i => i.name === app.name) ? 'Enabled'
                                                              : 'Disabled';
          return index + '. ' + app.name + ' – ' + status;
        }).join('\n');

        return message.reply(msg);
      }

      if (command === 'enable' || command === 'disable') {
        let target = APPS.find(i => i.name === arg);

        if (!target) {
          return message.reply(`Application ${arg} doesn't exist`);
        }
        if (command === 'enable') {
          bot.pocket.save('NewrelicApp', target).then(() => {
            message.reply(`Application ${arg} is enabled now.`);

            let index = ENABLED.findIndex(i => i.id === target.id);
            if (index === -1) {
              ENABLED.push(target);
            }
          }, () => {
            message.reply(FAIL);
          });
        }

        if (command === 'disable') {
          bot.pocket.remove('NewrelicApp', {id: target.id}).then(() => {
            message.reply(`Application ${arg} is disabled now.`);

            let index = ENABLED.findIndex(i => i.id === target.id);
            if (index > -1) {
              ENABLED.splice(index, 1);
            }
          }, () => {
            message.reply(FAIL);
          });
        }
      }
    }, { permissions: ['admin', 'server'] });
  })

  bot.help('newrelic', 'manage newrelic alerts', `
    list — show a list of newrelic applications\n
    enable <appname> — enable application monitoring\n
    disable <appname> — disable application monitoring
  `);
}

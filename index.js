const axios = require('axios');
const querystring = require('querystring');
const sortBy = require('lodash.sortby');
const keys = require('lodash.keys');
const get = require('lodash.get');
const fs = require('mz/fs');
const mkdir = require('mkdirp');
const path = require('path');
require('dotenv').config();

const { API_KEY } = process.env;

const getHistory  = async (data) => {
    let dataQueryString = querystring.stringify(data)
    await delay(1000);
    return await axios.post('https://slack.com/api/conversations.history', dataQueryString);
}

const getUserIdMessageCount = (history, messages) => {
    messages.forEach(message => {
        history[message.user] = (history[message.user] || 0) + 1;
    })
    return history;
}

const getLatest = channel => {
    if (!channel || !channel.messages || channel.messages.length === 0) {
        return null;
    }
    return channel.messages[channel.messages.length - 1].ts;
}

const writeChannel = async (channel, existingChannel = {}, messages = []) => {
    const channelData = Object.assign({}, channel, existingChannel, {
        messages: (existingChannel.messages || []).concat(messages)
    });

    await fs.writeFile(`channels/${channel.id}.json`, JSON.stringify(channelData), 'utf8')
        .catch(e => {
            console.warn(`Failed on writing channel ${channel.id}`);
        });

    return channelData;
};

const getAllHistory = async (channels, existingChannels = {}) => {
    let history = {};
    for(channel of channels) {
        const latest = getLatest(existingChannels[channel.id]);
        const existingMessages = get(existingChannels, `${channel.id}.messages`, []);
        if (latest) {
            console.log(`${channel.id} is cached; using ${latest} as oldest message`);
        }
        const data = Object.assign({}, { 
            "token": API_KEY,
            "channel": channel.id,
            "limit": 1000
        }, latest ? {
            oldest: latest
        } : {});
        let messages = [];
        try {
            let historyResponse = await getHistory(data);
            messages = messages.concat(historyResponse.data.messages);
            let i = 0;
            while(historyResponse.data.has_more) {
                data.cursor = historyResponse.data.response_metadata.next_cursor;
                historyResponse = await getHistory(data);
                messages = messages.concat(historyResponse.data.messages);
                getUserIdMessageCount(history, historyResponse.data.messages);
                i++;
            }
            messages = sortBy(messages, 'ts');
            history = getUserIdMessageCount(history, existingMessages.concat(messages));
            await writeChannel(channel, existingChannels[channel.id], messages);
        } catch(e) {
            if(e.response && e.response.status === 429) {
                await delay(e.response.headers['retry-after'] * 1000);
            } else {
                console.warn(e);
            }
        }
    }
    return history;
}

const getCachedChannels = async () => {
    const base = path.resolve('channels');
    const channels = await fs.readdir(base);

    let cache = {};
    for (let cachedChannelPath of channels) {
        const [id] = cachedChannelPath.split('.json');
        let channel;
        try {
            const contents = await fs.readFile(path.join(base, cachedChannelPath), 'utf8');
            channel = JSON.parse(contents);
        } catch (e) {
            channel = {};
        }
        cache[id] = channel;
    }

    return cache;
};

const getAllChannels = async () => {
    var data = querystring.stringify({ 
        "token": API_KEY
    });
    const channelResponse = await axios.post('https://slack.com/api/channels.list', data)
    const channels = channelResponse.data.channels
        .map(channel => ({
            id: channel.id, 
            userCount: channel.num_members, 
            name: channel.name
        }))
        .filter(channel => channel.userCount > 2);
    return sortBy(channels, 'userCount').reverse().slice(0, 5);
}

const getAllUsers = async () => {
    var data = querystring.stringify({ 
        "token": API_KEY
    });
    const usersResponse = await axios.post('https://slack.com/api/users.list', data)
    return usersResponse.data.members
        .map(user => ({
            id: user.id,
            name: user.real_name  
        }))
}

const delay = duration => new Promise(resolve => setTimeout(resolve, duration));

(async () => {
    try {
        await mkdir('channels');
        const cached = await getCachedChannels();
        const channels = await getAllChannels();
        console.log(`# of channels: ${channels.length}`);
        const history = await getAllHistory(channels, cached);
        const allUsers = await getAllUsers();
        const userNamesCount = keys(history).map(userId => ({
            user: allUsers.find(user => user.id === userId),
            count: history[userId]
        }));
        const sorted = sortBy(userNamesCount, 'count').reverse();
        await fs.writeFile("user_stats.json", JSON.stringify(sorted))
            .catch(e => {
                console.warn(e);
                throw e;
            });
    } catch (e) {
        console.log(e);
    }
})()
const axios = require('axios');
const querystring = require('querystring');
const _ = require('lodash');
const fs = require('fs');
const { API_KEY } = process.env;

const getHistory  = async (data) => {
    let dataQueryString = querystring.stringify(data)
    await delay(1000);
    return await axios.post('https://slack.com/api/conversations.history', dataQueryString);
}

const getUserIdMessageCount = (history, messages) => {
    messages.forEach(message => {
        if(history[message.user]) {
            history[message.user] = history[message.user] + 1;
        } else {
            history[message.user] = 1;
        }
    })
} 

const getAllHistory = async (channels) => {
    let history = {};
    for(channel of channels) {
        const data = { 
            "token": API_KEY,
            "channel": channel.id,
            "limit": 1000
        };
        try {
            let historyResponse = await getHistory(data);
            getUserIdMessageCount(history, historyResponse.data.messages);
            let i = 0;
            while(historyResponse.data.has_more) {
                data.cursor = historyResponse.data.response_metadata.next_cursor;
                historyResponse = await getHistory(data);
                getUserIdMessageCount(history, historyResponse.data.messages);
                i++;
            }
        } catch(e) {
            if(e.response && e.response.status === 429) {
                await delay(e.response.headers['retry-after'] * 1000);
                console.log(channel)
            } else {
                console.log(e);
            }
        }
    }
    return history;
}

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
    return _.sortBy(channels, 'userCount').reverse();
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

const delay = async(t) => {
    return new Promise(function(resolve) { 
        setTimeout(resolve, t)
    });
 }

(async ()=> {
    try {
        const channels = await getAllChannels();
        console.log(`# of channels: ${channels.length}`);
        const history = await getAllHistory(channels);

        const allUsers = await getAllUsers();
        const userNamesCount = _.keys(history).map(userId => ({
            user: allUsers.find(user => user.id === userId),
            count: history[userId]
        }));
        const sorted = _.sortBy(userNamesCount, 'count').reverse();
        fs.writeFile("tmp/history_all_users.json", JSON.stringify(sorted), function(err) {
            if(err) {
                return console.log(err);
            }
        }); 
    } catch (e) {
        console.log(e);
    }

})()
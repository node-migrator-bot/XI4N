"use strict";

/**
 * state.js adds a general state management and API for other plugins
 *
 * Events that maybe subscribed to:
 *  - STA_CONNNEW: new connection, sends ucid
 *  - STA_CONNLEAVE: leaving connection, sends ucid
 *  - STA_CONNREN: connection rename, sends ucid
 *  - STA_PLYRNEW: new player, sends plid
 *  - STA_PLYRLEAVE: player leaves race, sends plid
 *  - STA_PLYRSWAP: 2 connections swap (player take over), sends plid
 *  - STA_PLYRUPDATE: player change (pits/unpits/position), sends array of plids
 *  - STA_OOS: if you subscribe to this event you MUST check whether or not you
 *             should handle it based on the last STA_OOS. for simplicity use
 *             state.handleOOS() to determime this
 *
 * i.e. in your dependent plugin:
 * this.client.on('STA_CONNNEW', function(ucid)
 * {
 *     var conn = this.client.state.getConnByUcid(ucid);
 *
 *     console.log('New connection %d - %s', ucid, conn.uname);
 * });
 */

var utils = require('util'),
	events = require('events');

var StateBase = function() {};

StateBase.prototype = {
	'fromPkt': function(pkt)
	{
		var props = pkt.getProperties();

		for (var i in props)
		{
			var propK = props[i];
			var propV = pkt[propK];

			if ((typeof propV != 'function') && (this[i] !== 'undefined'))
				this[propK] = propV;
		}
	}
};

var ConnState = function(pkt)
{
	var self = this;

	self.ucid = 0;
	self.admin = false;
	self.uname = '';
	self.flags = 0;

	self.plid = 0;

	// setup, from IS_NCN
	if (pkt)
		self.fromPkt(pkt);
}

utils.inherits(ConnState, StateBase);

var PlyrState = function(pkt)
{
	var self = this;

	self.plid = 0;

	self.ucid = 0;
	self.ptype = 0;
	self.flags = 0;

	self.pname = '';
	self.plate = '';
	self.cname = '';
	self.sname = '';
	self.tyres = 0;
	
	self.h_mass = 0;
	self.h_tres = 0;
	self.model = 0;
	self.pass = 0;
	self.setf = 0;
	self.pitting = false; // tele-pitting

	self.node = 0;
	self.lap = 0;
	self.position = 0;
	self.info = 0;
	self.x = 0;
	self.y = 0;
	self.z = 0;
	self.speed = 0;
	self.direction = 0;
	self.heading = 0;
	self.angvel = 0;

	self.ttime = 0;
	self.btime = 0;
	self.numstops = 0;
	self.lapsdone = 0;
	self.resultnum = 0;
	self.pseconds = 0;

	self.penalty = 0; // current penalty, if any
	self.ltime = 0;
	self.etime = 0;
	self.stime = 0;

	self.finalresult = false; // is the final result

	// setup from IS_NPL
	if (pkt)
		this.fromPkt(pkt);
}

PlyrState.prototype = {
	'clearLastResult': function()
	{
		this.ttime = 0;
		this.btime = 0;
		this.numstops = 0;
		this.lapsdone = 0;
		this.resultnum = 0;
		this.pseconds = 0;
		this.penalty = 0;
		this.finalresult = false;
	}
}

utils.inherits(PlyrState, StateBase);

var ClientState = function() {
	var self = this;

	self.lfs = {
		'version': '', // lfs version
		'product': '', // lfs product name (Demo, S1, S2)
		'insimver': 5 // insim version
	};

	self.host = false; // is host?
	self.hname = ''; // hostname

	self.replayspeed = 1;
	self.flags = 0; // state flags
	self.ingamecam = 0;
	self.viewplid = 0; // currently viewing this plid

	self.raceinprog = 0; // 0 = no race, 1 = race, 2 = qualifying
	self.qualmins = 0; // number of qualifying mins
	self.racelaps = 0; // laps

	self.track = ''; // short trackname
	self.weather = ''; // 0-2
	self.wind = ''; // 0-2, none-weak-strong

	self.axstart = 0; // ax start node
	self.numcp = 0; // number of cps
	self.numo = 0; // number of objects
	self.lname = ''; // layout name, if any

	self.conns = [];
	self.plyrs = [];

	self.lastOOS = (new Date).getTime()-10000;
};

ClientState.prototype = {
	 'lfs': {
		'version': '', // lfs version
		'product': '', // lfs product name (Demo, S1, S2)
		'insimver': 5 // insim version
	},
	// helper functions
	'getPlyrByPlid': function(plid)
	{
		var self = this;

		return self.plyrs[plid];
	},
	'getPlyrByUcid': function(ucid)
	{
		var self = this;

		if (!self.conns[ucid])
			return;

		return self.plyrs[self.conns[ucid].plid];
	},
	'getConnByUcid': function(ucid)
	{
		var self = this;

		return self.conns[ucid];
	},
	'getConnByPlid': function(plid)
	{
		var self = this;

		if (!self.plyrs[plid])
			return;

		return self.conns[self.plyr[plid].ucid];
	},

	'handleOOS': function()
	{
		// if you decide to use STA_OOS you MUST use this function to prevent
		// horrible loops of requests from occuring

		var now = (new Date).getTime();

		// prevent too many OOS'
		if ((now - this.lastOOS) <= 10000)
			return false;

		this.lastOOS = now;	

		return true;
	},

	// request the current state from LFS
	'requestCurrentState': function()
	{
		var self = this.client.state;

		if (!self.handleOOS())
		{
			this.log.debug('OOS - Ignoring, <= 10s since last OOS');
			return;
		}

		this.log.debug('OOS - Requesting data');

		// FIXME in a loop sending these 4 pkts breaks horribly..
		// TODO figure out why
		var t0 = new this.insim.IS_TINY();
		t0.reqi = 1;
		t0.subt = this.insim.TINY_ISM;
		this.client.send(t0);

		var t1 = new this.insim.IS_TINY();
		t1.reqi = 1;
		t1.subt = this.insim.TINY_NCN;
		this.client.send(t1);

		var t2 = new this.insim.IS_TINY();
		t2.reqi = 1;
		t2.subt = this.insim.TINY_NPL;
		this.client.send(t2);

		var t3 = new this.insim.IS_TINY();
		t3.reqi = 1;
		t3.subt = this.insim.TINY_SST;
		this.client.send(t3);
	},

	// state ready
	'onIS_VER': function(pkt)
	{
		var self = this.client.state;

		self.lfs.version = pkt.version;
		self.lfs.product = pkt.product;
		self.lfs.insimver = pkt.insimver;

		this.client.emit('STA_OOS');
	},

	// game state
	// IS_STA or IS_RST
	'onGeneric_Copy': function(pkt)
	{
		var self = this.client.state;

		// useful function that can be used when we just need to copy
		// game state change or race start
		// we just blindly copy 
		var props = pkt.getProperties();

		for (var i in props)
		{
			var propK = props[i];
			var propV = pkt[propK];

			if ((typeof propV != 'function') && (self[i] !== 'undefined'))
				self[propK] = propV;
		}
	},
	'onIS_ISM': function(pkt)
	{
		var self = this.client.state;
		//  multiplayer start/join
		
		self.host = pkt.host;
		self.hname = pkt.hname;

		this.client.emit('STA_OOS');
	},
	'onIS_RST': function(pkt)
	{
		var self = this.client.state;
		//  multiplayer start/join
		
		self.onGeneric_Copy.call(this);
		
		for (var i in self.plyrs)
			self.plyrs[i].clearLastResult();
	},

	// connection specific hooks
	'onIS_NCN': function(pkt)
	{
		var self = this.client.state;
		// new connection

		var c = new ConnState(pkt);
		self.conns[c.ucid] = c;

		this.client.emit('STA_CONNNEW', c.ucid);
	},
	'onIS_CNL': function(pkt)
	{
		var self = this.client.state;
		// connection leaves

		if (!self.conns[pkt.ucid])
			return;
		
		if ((self.conns[pkt.ucid].plid > 0) && (self.plyrs[self.conns[pkt.ucid].plid]))
			delete self.plyrs[self.conns[pkt.ucid].plid];

		delete self.conns[pkt.ucid];

		this.client.emit('STA_CONNLEAVE', pkt.ucid);
	},
	'onIS_CPR': function(pkt)
	{
		var self = this.client.state;
		// connection rename

		if (!self.conns[pkt.ucid])
			return;

		self.conns[pkt.ucid].pname = pkt.pname;
		self.conns[pkt.ucid].plate = pkt.plate;

		this.client.emit('STA_CONNREN', pkt.ucid);
	},

	// player specific hooks
	'onIS_NPL': function(pkt)
	{
		var self = this.client.state;
		var p = null;
		var n = false;
		
		if (!self.plyrs[pkt.plid])
		{
			// new/unknown plyr
			p = new PlyrState(pkt);
			self.plyrs[p.plid] = p;
			n = true;
		}
		else
		{
			// existing, un-pitting plyr, update our info
			p = self.plyrs[pkt.plid];
			p.fromPkt(pkt);
			p.pitting = false;
		}

		if (self.conns[p.ucid])
			self.conns[p.ucid].plid = p.plid;

		if (n)
			this.client.emit('STA_PLYRNEW', pkt.plid);
		else
			this.client.emit('STA_PLYRUPDATE', [ pkt.plid ]);
	},
	'onIS_PLP': function(pkt)
	{
		var self = this.client.state;
		// player tele-pits

		if (!self.plyrs[pkt.plid])
			return;

		self.plyrs[pkt.plid].pitting = true;

		// emit our custom event
		this.client.emit('STA_PLYRUPDATE', [ pkt.plid ]);
	},
	'onIS_PLL': function(pkt)
	{
		var self = this.client.state;

		// player leaves
		if (!self.plyrs[pkt.plid])
		{
			// out of sync, lets get sync
			this.log.crit('plyrs out of sync');
			this.client.emit('STA_OOS');
			return; 
		}

		var ucid = self.plyrs[pkt.plid].ucid;
		delete self.plyrs[pkt.plid];

		if ((ucid > 0) && (self.conns[ucid]))
			self.conns[ucid].plid = 0; // out of sync if this doesn't happen

		this.client.emit('STA_PLYRLEAVE', pkt.plid);
	},
	'onIS_TOC': function(pkt)
	{
		var self = this.client.state;

		// player takes over vehicle (connection->player swapping)
		if ((!self.plyrs[pkt.plid]) || (self.plyrs[pkt.plid].ucid != pkt.olducid))
		{
			// out of sync, lets get sync
			this.log.crit('plyrs out of sync');
			this.client.emit('STA_OOS');
			return;
		}

		self.plyrs[pkt.plid].ucid = pkt.newucid;
		self.conns[pkt.newucid].plid = pkt.plid;

		this.client.emit('STA_PLYRSWAP', pkt.plid);
	},
	'onIS_FIN': function(pkt)
	{
		var self = this.client.state;
		// player finish notification
		// not final result

		if (!self.plyrs[pkt.plid])
			return;

		self.plyrs[pkt.plid].fromPkt(pkt);
		self.plyrs[pkt.plid].finalresult = false;

		// emit our custom event
		this.client.emit('STA_PLYRUPDATE', [ pkt.plid ]);
	},
	'onIS_LAPSPX': function(pkt)
	{
		var self = this.client.state;

		if (!self.plyrs[pkt.plid])
		{
			// out of sync, lets get sync
			this.log.crit('plyrs out of sync');
			this.client.emit('STA_OOS');
			return; 
		}

		self.plyrs[pkt.plid].fromPkt(pkt);

		this.client.emit('STA_PLYRUPDATE', [ pkt.plid ]);
	},
	'onIS_RES': function(pkt)
	{
		var self = this.client.state;
		// player finish result
		// final result

		if (!self.plyrs[pkt.plid])
			return;

		self.plyrs[pkt.plid].fromPkt(pkt);
		self.plyrs[pkt.plid].finalresult = true;

		// emit our custom event
		this.client.emit('STA_PLYRUPDATE', [ pkt.plid ]);
	},
	'onIS_MCI': function(pkt)
	{
		var self = this.client.state;

		var updated = [];

		// positioning update
		for(var i in pkt.compcar)
		{
			var p = pkt.compcar[i];

			if (!self.plyrs[p.plid])
			{
				// out of sync, lets get sync
				this.log.crit('plyrs out of sync');
				this.client.emit('STA_OOS');
				continue; 
			}

			self.plyrs[p.plid].fromPkt(p);
			updated.push(p.plid);
		}

		// emit our custom event
		this.client.emit('STA_PLYRUPDATE', updated);
	},

	// hooks, helper array
	'hooks': {
		'STA_OOS': 'requestCurrentState',

		'IS_VER': 'onIS_VER',

		'IS_STA': 'onGeneric_Copy',
		'IS_RST': 'onIS_RST',
		'IS_AXI': 'onGeneric_Copy',
		'IS_ISM': 'onIS_ISM',

		'IS_NCN': 'onIS_NCN',
		'IS_CNL': 'onIS_CNL',
		'IS_CPR': 'onIS_CPR',

		'IS_NPL': 'onIS_NPL',
		'IS_PLP': 'onIS_PLP',
		'IS_PLL': 'onIS_PLL',
		'IS_TOC': 'onIS_TOC',
		'IS_FIN': 'onIS_FIN',
		'IS_RES': 'onIS_RES',
		'IS_LAP': 'onIS_LAPSPX',
		'IS_SPX': 'onIS_LAPSPX',
		'IS_MCI': 'onIS_MCI',
	},

	// hook helpers
	'registerHooks': function(client)
	{
		var self = this;

		// register all hooks
		for (var i in self.hooks)
			client.registerHook(i, self[self.hooks[i]]);
	},
	'unregisterHooks': function(client)
	{
		var self = this;

		// unregister all hooks
		for (var i in self.hooks)
			client.unregisterHook(i, self[self.hooks[i]]);
	}
};

exports.init = function(options)
{
	this.log.info('Registering state plugin');

	this.client.isiFlags |= this.insim.ISF_MCI;

	this.client.registerHook('preconnect', function()
	{
		// setup state
		this.client.state = new ClientState;

		// setup hooks
		this.client.state.registerHooks(this.client);

		this.client.emit('STA_READY');
	});

	this.client.registerHook('disconnect', function()
	{
		// we're going to be lazy and tear down the whole state on a 
		// disconnection, so we'll need to completely remove all the hooks first

		this.client.emit('STA_NOTREADY');

		// clear hooks
		this.client.state.unregisterHooks(this.client);

		// clear any known state
		this.client.state = undefined;
	});
}
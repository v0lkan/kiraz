'use strict';

/*
 * __.--~~.,-.__            «« kiraz — tap into live Node.JS apps »»
 * `~-._.-(`-.__`-.
 *         \     This program is distributed under the terms of the MIT license.
 *          \--.       Please see the `LICENSE.md` file for details.
 *         /#   \
 *         \    /            Send your comments and suggestions to:
 *          '--'            <https://github.com/v0lkan/kiraz/issues>
 */

/**
 * Module dependencies.
 */

var debug = require('debug')('jstrace:server');
var actorify = require('actorify');
var Remote = require('./remote');
var assert = require('assert');
var Backoff = require('backo');
var utils = require('./utils');
var net = require('net');
var os = require('os');

/**
 * Expose `Server`.
 */

module.exports = Server;

/**
 * Initialize a new server.
 *
 * @api private
 */

function Server() {
  this.stopped = false;

  // this.connect = this.connect.bind(this);
  // this.disconnect = this.disconnect.bind(this);

  this.backoff = new Backoff({ min: 100, max: 5000 });
  this.hostname = os.hostname();
  this.pid = process.pid;
  this.port = 4322;
  this.regexp = null;
  this.remote = null;
  this.remoteRegexp = null;
  this.subscribing = false;
}

/**
 * Return process title.
 *
 * @api private
 */

Server.prototype.__defineGetter__('title', function(){
  return process.title;
});

/**
 * Subscribe to the given `opts`.
 *
 * @param {Object} opts
 * @api private
 */

Server.prototype.subscribe = function(opts){
  debug('subscribe %j', opts);

  // hostname filtering
  if (opts.hostname && opts.hostname != this.hostname) return debug('host mismatch');

  // pid filtering
  if (opts.pid && opts.pid != this.pid) return debug('pid mismatch');

  // process title filtering
  if (opts.title && opts.title != this.title) return debug('title mismatch');

  // patterns
  this.regexp = utils.patterns(opts.patterns);
  this.subscribing = true;

  // remote function
  if (opts.remote) this.remote = new Remote(opts.remote, this);
};

/**
 * Unsubscribe from all patterns.
 *
 * @api private
 */

Server.prototype.unsubscribe = function(){
  debug('unsubscribe');
  this.subscribing = false;
};

/**
 * Check if any subscription patterns match the probe `name`.
 *
 * @param {String} name
 * @return {Boolean}
 * @api private
 */

Server.prototype.subscribed = function(name){
  return this.regexp.test(name);
};

/**
 * Send trace data to the client.
 *
 * @param {String} name
 * @param {Object} obj
 * @api private
 */

Server.prototype.send = function(name, obj){
  debug('send %j %j', name, obj);
  if (!this.actor) return debug('no actor');

  try {
    this.actor.send('trace', this.trace(name, obj));
  } catch (err) {
    return this.actor.send('error', this.prefix(err.stack));
  }
};

/**
 * Return a trace `obj` decorated with:
 *
 *  - timestamp
 *  - hostname
 *  - title
 *  - pid
 *  - name
 *
 * @param {String} name
 * @param {Object} obj
 * @return {Object}
 * @api private
 */

Server.prototype.trace = function(name, obj){
  return merge({
    hostname: this.hostname,
    timestamp: Date.now(),
    title: this.title,
    pid: this.pid,
    name: name
  }, obj);
};

/**
 * Communicate with the peer.
 *
 * @param {Socket} sock
 * @api private
 */

Server.prototype.onconnection = function(sock){
  var actor = this.actor = actorify(sock);
  actor.on('subscribe', this.subscribe.bind(this));
};


Server.prototype.disconnect = function() {
    if (!this.sock) {return;}

    this.sock.close();
};

/**
 * Attempt connection with jstrace(1).
 *
 * @api private
 */

Server.prototype.connect = function( options ) {
  // TODO: move this to a config file.
  var opt = {host:'0.0.0.0', port:4322};

  merge(opt, options || {});

  var sock = net.connect(opt);
  var self = this;

  self.sock = sock;

  debug('connecting');
  sock.on('connect', function(){
    debug('connected');
    self.backoff.reset();
    self.onconnection(sock);
  });

  sock.on('error', function(err){
    debug('error %s', err.message);
    retry(options);
  });

  sock.on('end', function(){
    debug('disconnected');
    delete self.actor;
    retry(options);
  });

  function retry(options) {
    self.unsubscribe();

    if (self.stopped) { return; }

    setTimeout(
        function() {self.connect(options);},
        self.backoff.duration()
    );
  }
};

/**
 * Start the server.
 *
 * @api private
 */

Server.prototype.start = function(options){
  debug('start');
  this.stopped = false;
  this.connect(options);
};

Server.prototype.stop = function(){
  this.stopped = true;
  this.disconnect();
}

/**
 * Prefix `str` with info about the server.
 *
 * @param {String} str
 * @return {String}
 * @api private
 */

Server.prototype.prefix = function(str){
  var pre = [this.hostname, this.title, this.pid].join('/');
  return pre + ' >> ' + str;
};

/**
 * Merge `b` into `a` and return `a`.
 *
 * Throws if properties overlap.
 *
 * @param {Object} a
 * @param {Object} b
 * @return {Object} a
 * @throws {Error}
 * @api private
 */

function merge(a, b) {
  if (!b) return a;

  if (b.toJSON) b = b.toJSON();

  Object.keys(b).forEach(function(k){
    a[k] = b[k];
  });

  return a;
}

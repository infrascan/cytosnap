let Promise = require('bluebird');
let browserify = require('browserify');
let fs = require('fs');
let base64 = require('base64-stream');
let stream = require('stream');
let path = require('path');
let os = require('os');
let typeofFn = typeof function () {};
let isFunction = (x) => typeof x === typeofFn;
let Handlebars = require('handlebars');
let readFile = Promise.promisify(fs.readFile);
let writeFile = Promise.promisify(fs.writeFile);

let callbackifyValue = function (fn) {
	return function (val) {
		if (isFunction(fn)) {
			fn(null, val);
		}

		return val;
	};
};

let callbackifyError = function (fn) {
	return function (err) {
		if (isFunction(fn)) {
			fn(err);
		}

		throw err;
	};
};

let getStream = function (text) {
	let s = new stream.Duplex();

	s.push(text);
	s.push(null);

	return s;
};

let browserSrc;

let browserifyBrowserSrc = function (destinationDir) {
	if (browserSrc != null) {
		return browserSrc;
	}

	browserSrc = new Promise(function (resolve) {
		browserify()
			.add(path.join(destinationDir || __dirname, './browser/index.js'))
			.bundle()
			.on('end', resolve)
			.pipe(
				fs.createWriteStream(
					path.join(destinationDir || __dirname, './browser/index.pack.js')
				)
			);
	});

	return browserSrc;
};

let ensureDestinationDirExists = function (destinationDir) {
	if (destinationDir == null) {
		return;
	}
	if (
		!fs.existsSync(destinationDir) ||
		!fs.existsSync(path.join(destinationDir, 'browser'))
	) {
		fs.mkdirSync(path.join(destinationDir, 'browser'), {
			recursive: true,
		});
		return require('fs-extra').copySync(
			'./node_modules',
			path.join(destinationDir, 'node_modules')
		);
	}
};

let moveWebpage = function (destinationDir) {
	let readWebpage = () => {
		return readFile(path.join(__dirname, './browser/index.html'));
	};

	let writeWebpage = (contents) => {
		return writeFile(
			path.join(destinationDir || __dirname, './browser/index.html'),
			contents
		);
	};

	return Promise.try(readWebpage).then(writeWebpage);
};

let Cytosnap = function (launchPuppeteer, opts = {}) {
	if (!(this instanceof Cytosnap)) {
		return new Cytosnap(launchPuppeteer, opts);
	}

	this.options = Object.assign({}, opts);

	// options to pass to puppeteer.launch()
	this.options.puppeteer = Object.assign(
		{
			// defaults
			args: opts.args, // backwards compat
			headless: true,
		},
		opts.puppeteer
	);

	if (launchPuppeteer == null) {
		throw new Error('No puppeteer launcher provided');
	}
	this.launchPuppeteer = launchPuppeteer;

	this.running = false;
	ensureDestinationDirExists(this.options.destinationDir);
};

let extensions = [];

Cytosnap.use = function (exts) {
	extensions = exts;
};

let wroteExtensionList = false;

let writeExtensionsList = function (destinationDir) {
	if (wroteExtensionList) {
		return Promise.resolve();
	}

	let readTemplate = () =>
		readFile(path.join(__dirname, './browser/index.js.hbs'), 'utf8');

	let writeJs = (contents) =>
		writeFile(
			path.join(destinationDir || __dirname, './browser/index.js'),
			contents
		);

	let fillTemplate = (template) => {
		return Handlebars.compile(template)({ extensions });
	};

	let done = () => (wroteExtensionList = true);

	return Promise.try(readTemplate).then(fillTemplate).then(writeJs).then(done);
};

let proto = Cytosnap.prototype;

proto.start = function (next) {
	let snap = this;

	return Promise.try(function () {
		return snap.launchPuppeteer(snap.options.puppeteer);
	})
		.then(function (browser) {
			snap.browser = browser;

			snap.running = true;
		})
		.then(callbackifyValue(next))
		.catch(callbackifyError(next));
};

proto.stop = function (next) {
	let snap = this;

	return Promise.try(function () {
		snap.browser.close();
	})
		.then(function () {
			snap.running = false;
		})
		.then(callbackifyValue(next))
		.catch(callbackifyError(next));
};

proto.shot = function (opts, next) {
	let snap = this;
	let page;

	opts = Object.assign(
		{
			// defaults
			elements: [],
			style: [],
			layout: { name: 'grid' },
			format: 'png',
			background: 'transparent',
			quality: 85,
			width: 200,
			height: 200,
			resolvesTo: 'base64uri',
		},
		opts
	);

	if (opts.format === 'jpg') {
		opts.format = 'jpeg';
	} else if (opts.format === 'png') {
		opts.quality = 0; // most compression
	}

	return Promise.try(function () {
		return writeExtensionsList(snap.options.destinationDir);
	})
		.then(function () {
			return browserifyBrowserSrc(snap.options.destinationDir);
		})
		.then(function () {
			if (snap.options.destinationDir) {
				return moveWebpage(snap.options.destinationDir);
			} else {
				return true;
			}
		})
		.then(function () {
			return snap.browser.newPage();
		})
		.then(function (puppeteerPage) {
			page = puppeteerPage;
		})
		.then(function () {
			return page.setViewport({ width: opts.width, height: opts.height });
		})
		.then(function () {
			let patchUri = function (uri) {
				if (os.platform() === 'win32') {
					return '/' + uri.replace(/\\/g, '/');
				} else {
					return uri;
				}
			};
			return page.goto(
				'file://' +
					patchUri(
						path.join(
							snap.options.destinationDir
								? path.resolve(snap.options.destinationDir)
								: __dirname,
							'./browser/index.html'
						)
					)
			);
		})
		.then(function () {
			if (!isFunction(opts.style)) {
				return Promise.resolve();
			}

			let js = 'window.styleFunction = (' + opts.style + ')';

			return page.evaluate(js);
		})
		.then(function () {
			if (!isFunction(opts.layout)) {
				return Promise.resolve();
			}

			let js = 'window.layoutFunction = (' + opts.layout + ')';

			return page.evaluate(js);
		})
		.then(function () {
			let js = 'window.options = ( ' + JSON.stringify(opts) + ' )';

			return page.evaluate(js);
		})
		.then(function () {
			let js =
				'document.body.style.setProperty("background", "' +
				opts.background +
				'")';

			return page.evaluate(js);
		})
		.then(function () {
			if (opts.sleep == null) {
				return Promise.resolve();
			}

			let js = 'window._sleep = ' + opts.sleep;
			return page.evaluate(js);
		})
		.then(function () {
			return page.evaluate(function () {
				/* global window, options, cy, layoutFunction, styleFunction */
				if (window.layoutFunction) {
					options.layout = layoutFunction();
				}

				if (window.styleFunction) {
					options.style = styleFunction();
				}

				cy.style(options.style);

				cy.add(options.elements);

				let layoutDone = cy.promiseOn('layoutstop');

				cy.makeLayout(options.layout).run(); // n.b. makeLayout used in case cytoscape@2 support is desired

				if (window._sleep != null) {
					return layoutDone.then(() => {
						return new Promise((resolve) =>
							setTimeout(resolve, Number(window._sleep))
						);
					});
				}

				return layoutDone;
			});
		})
		.then(function () {
			if (opts.resolveTo === 'json') {
				return null;
			} // can skip in json case

			return page.screenshot({
				type: opts.format,
				quality: opts.quality,
				encoding: 'base64',
			});
		})
		.then(function (b64Img) {
			switch (opts.resolvesTo) {
				case 'base64uri':
					return 'data:image/' + opts.format + ';base64,' + b64Img;
				case 'base64':
					return b64Img;
				case 'stream':
					return getStream(b64Img).pipe(base64.decode());
				case 'json':
					return page.evaluate(function () {
						let posns = {};

						cy.nodes().forEach(function (n) {
							posns[n.id()] = n.position();
						});

						return posns;
					});
				default:
					throw new Error('Invalid resolve type specified: ' + opts.resolvesTo);
			}
		})
		.then(function (img) {
			return page.close().then(function () {
				return img;
			});
		})
		.then(callbackifyValue(next))
		.catch(callbackifyError(next));
};

module.exports = Cytosnap;

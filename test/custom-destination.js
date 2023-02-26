var chai = require('chai');
var expect = chai.expect;
var cytosnap = require('..');
var Promise = require('bluebird');
var puppeteer = require('puppeteer');
const { createWriteStream, existsSync } = require('fs');

cytosnap.use(['cytoscape-dagre']);

describe('Custom Dest', function () {
	var snap;

	this.timeout(100000);

	function launchPuppeteer(opts) {
		return puppeteer.launch(opts);
	}

	beforeEach(function (done) {
		// setup
		snap = cytosnap(launchPuppeteer, {
			puppeteer: {
				args: ['--no-sandbox'], // required for travis ci
			},
			destinationDir: './custom-dest',
		});

		snap.start().then(done);
	});

	afterEach(function (done) {
		// teardown
		snap
			.stop()
			.then(function () {
				snap = null;
			})
			.then(done);
	});

	it('should exist (png)', function (done) {
		snap
			.shot({
				elements: [
					{
						data: { id: 'foo' },
					},
					{
						data: { id: 'bar' },
					},
					{
						data: { source: 'foo', target: 'bar' },
					},
				],
				format: 'png',
				width: 1000,
				height: 1000,
				resolvesTo: 'stream',
			})
			.then(function (img) {
				expect(existsSync('./custom-dest/browser/index.js')).to.be.true;
				expect(img).to.exist;
				return img;
			})
			.then(function (img) {
				// put the image in the fs for manual verification
				return new Promise(function (resolve) {
					var out = createWriteStream('./custom-dest/img.png');

					img.pipe(out);

					out.on('finish', resolve);
				});
			})
			.then(done);
	});
});

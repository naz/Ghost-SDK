const cheerio = require('cheerio');
const absoluteToRelative = require('./absolute-to-relative');

function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function _absoluteToRelative(url, siteUrl, options) {
    const staticImageUrlPrefixRegex = new RegExp(options.staticImageUrlPrefix);

    if (options.assetsOnly && !url.match(staticImageUrlPrefixRegex)) {
        return;
    }

    // remove the site url (excluding sub-directory) from the url
    return absoluteToRelative(url, siteUrl, {ignoreProtocol: true});
}

function extractSrcsetUrls(srcset = '') {
    return srcset.split(',').map((part) => {
        return part.trim().split(/\s+/)[0];
    });
}

function htmlAbsoluteToRelative(html = '', siteUrl, options = {assetsOnly: false}) {
    const htmlContent = cheerio.load(html, {decodeEntities: false});

    // replacements is keyed with the attr name + original absolute value so
    // that we can implement skips for untouchable urls
    //
    // replacements = {
    //     'href="https://mysite.com/test"': [
    //         {name: 'href', originalValue: 'https://mysite.com/test', relativeValue: '/test'},
    //         {name: 'href', originalValue: 'https://mysite.com/test', skip: true}, // found inside a <code> element
    //         {name: 'href', originalValue: 'https://mysite.com/test', relativeValue: '/test'},
    //     ]
    // }
    const replacements = {};

    function addReplacement(replacement) {
        const key = `${replacement.name}="${replacement.originalValue}"`;

        if (!replacements[key]) {
            replacements[key] = [];
        }

        replacements[key].push(replacement);
    }

    // find all of the absolute url attributes that we care about and populate the replacements object
    ['href', 'src', 'srcset'].forEach((attributeName) => {
        htmlContent('[' + attributeName + ']').each((ix, el) => {
            // ignore html inside of <code> elements
            if (htmlContent(el).closest('code').length) {
                addReplacement({
                    name: attributeName,
                    originalValue: htmlContent(el).attr(attributeName),
                    skip: true
                });
                return;
            }

            el = htmlContent(el);
            const originalValue = el.attr(attributeName);

            if (attributeName === 'srcset') {
                const urls = extractSrcsetUrls(originalValue);
                const relativeUrls = urls.map(url => _absoluteToRelative(url, siteUrl, options));
                let relativeValue = originalValue;

                urls.forEach((url, i) => {
                    if (relativeUrls[i]) {
                        let regex = new RegExp(escapeRegExp(url), 'g');
                        relativeValue = relativeValue.replace(regex, relativeUrls[i]);
                    }
                });

                if (relativeValue !== originalValue) {
                    addReplacement({
                        name: attributeName,
                        originalValue,
                        relativeValue
                    });
                }
            } else {
                // remove the site url (excluding sub-directory) from the url
                const relativeValue = _absoluteToRelative(originalValue, siteUrl, options);

                if (relativeValue) {
                    addReplacement({
                        name: attributeName,
                        originalValue,
                        relativeValue
                    });
                }
            }
        });
    });

    // Loop over all replacements and use a regex to replace urls in the original html string.
    // Allows indentation and formatting to be kept compared to using DOM manipulation and render
    for (const [, attrs] of Object.entries(replacements)) {
        let skipCount = 0;

        attrs.forEach((attr) => {
            if (attr.skip) {
                skipCount += 1;
                return;
            }

            const regex = new RegExp(`${attr.name}=['"](${escapeRegExp(attr.originalValue)})['"]`, 'g');
            let matchCount = 0;
            html = html.replace(regex, (match) => {
                let result = match;
                if (matchCount === skipCount) {
                    result = match.replace(attr.originalValue, attr.relativeValue);
                }
                matchCount += 1;
                return result;
            });
        });
    }

    return html;
}

module.exports = htmlAbsoluteToRelative;

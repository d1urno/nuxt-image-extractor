const fs = require('fs')
const { URL } = require('url')
const { join } = require('path')
const consola = require('consola')

const defaults = {
  path: '/_images', // dir where downloaded images will be stored
  extensions: ['jpg', 'jpeg', 'gif', 'png', 'webp', 'svg'],
  baseUrl: '' // cms url
  // TODO: add option to allow keeping the original folder structure
}

module.exports = function Extract (moduleOptions) {
  const options = { ...defaults, ...moduleOptions }
  const baseDir = join(this.options.generate.dir, options.path)
  const routerBase = this.options.router.base !== '/' ? this.options.router.base : ''
  const baseUrl = new URL(moduleOptions.baseUrl)

  this.nuxt.hook('generate:distCopied', () => {
    if (!fs.existsSync(baseDir)) { fs.mkdirSync(baseDir) }
  })

  this.nuxt.hook('generate:page', async (page) => {
    return await processPage(page)
  })

  this.nuxt.hook('generate:routeCreated', async ({ route }) => {
    const routePath = join(this.options.generate.dir, this.options.generate.staticAssets.versionBase, route)
    const payloadPath = join(routePath, 'payload.js')
    return await processPayload(payloadPath)
  })

  /**
   * Converts regex matches for both HTML and PAYLOAD responses into an Array of URL Objects
   */
  function urlsFromMatches (matches, isPayloadFormat = false) {
    const urls = []
    for (const match of matches) {
      let matchURLStrings = isPayloadFormat ? [decodeURIComponent(JSON.parse('"' + removeTrailingBackslash(match[0]) + '"'))] : [match[0]]
      const responsiveImagesRegex = /,?\s{1}[\d.]+[xwh]\s?,?\s?/gm
      const responsiveImageMatches = match[0].match(responsiveImagesRegex)
      if (responsiveImageMatches && responsiveImageMatches.length) {
        matchURLStrings = match[0].split(responsiveImagesRegex).filter(item => item.length)
      }
      const matchUrls = matchURLStrings.map(matchStr => new URL(matchStr))
      matchUrls.forEach((url) => {
        if (baseUrl.hostname === url.hostname && !urls.find(u => u.href === url.href)) {
          urls.push(url)
        }
      })
    }
    return urls
  }

  /**
   * Parses the generated page HTML for Asset URLs and replaces them in the page HTML
   */
  async function processPage (page) {
    const test = new RegExp('(http(s?):)([/|.|\\w|\\s|-]|%|:|~)*.(?:' + options.extensions.join('|') + '){1}[^"]*', 'g')
    const matches = page.html.matchAll(test)
    const urls = urlsFromMatches(matches)
    if (!urls.length) { return }
    consola.info(`${page.route}: nuxt-image-extractor is replacing ${urls.length} images with local copies`)
    return await replaceRemoteImages(page.html, urls).then(html => (page.html = html))
  }

  async function replaceRemoteImages (html, urls) {
    await Promise.all(
      urls.map(async (url) => {
        const ext = '.' + (url.pathname + url.hash).split('.').pop()
        const name = slugify((url.pathname + url.hash).split(ext).join('')) + ext
        const imgPath = join(baseDir, name)
        return await saveRemoteImage(url.href, imgPath)
          .then(() => {
            html = html.split(url.href).join(options.path + '/' + name)
          })
          .catch(e => consola.error(e))
      })
    )
    return html
  }

  function encodeSlashes (str) {
    return str.replace(/\//g, '\\u002F')
  }

  /**
   * Process the AJAX Payload objects, parse the URLs, download the objects
   */
  async function processPayload (payloadPath) {
    // Parse payload.js to get encoded URIs
    const test = new RegExp(
      '(http(s?):)([\\\\u002F|.|\\w|\\s|-]|%|:|~|\\\\u002F)*.(?:' + options.extensions.join('|') + '){1}[^"]*',
      'g'
    )

    const data = await fs.readFileSync(payloadPath, 'utf8')
    const matches = data.matchAll(test)

    // We might expect match[0] to be like:
    // https:\u002F\u002Fsubdomain.domain.com\u002Fassets\u002Fsome-image-5038843-1.jpg
    const urls = urlsFromMatches(matches, true)
    if (!urls.length) { return }

    const payload = await downloadAndReplacePayloadImageLinks(data, urls)
    await fs.writeFileSync(payloadPath, payload, 'utf8')
  }

  function encodeChars (str) {
    return (
      str
        .replace(/%/g, '%25') // Needs to be first in the chain
        // .replace(/`/g, '%60') this char ` is converted when URL is created
        .replace(/!/g, '%21')
        .replace(/@/g, '%40')
        .replace(/\^/g, '%5E')
        .replace(/#/g, '%23')
        .replace(/\$/g, '%24')
        .replace(/&/g, '%26')
        .replace(/\(/g, '%28')
        .replace(/\)/g, '%29')
        .replace(/=/g, '%3D')
        .replace(/\+/g, '%2B')
        .replace(/,/g, '%2C')
        .replace(/;/g, '%3B')
        .replace(/'/g, '%27')
        .replace(/\[/g, '%5B')
        .replace(/{/g, '%7B')
        .replace(/]/g, '%5D')
        .replace(/}/g, '%7D')
    )
  }

  /**
   * Download the images and update the payload content
   */
  async function downloadAndReplacePayloadImageLinks (payload, urls) {
    let count = 0
    await Promise.all(
      urls.map(async (url) => {
        const ext = '.' + (url.pathname + url.hash).split('.').pop()
        const preName = (url.pathname + url.hash).split(ext).join('')
        const name = slugify(encodeChars(preName)) + ext.split('?')[0]

        let remoteLink = url.href.split('.')
        remoteLink.pop()
        remoteLink = encodeSlashes(encodeChars(remoteLink.join('.'))) + ext

        const imgPath = join(baseDir, name)
        await saveRemoteImage(url, imgPath)

        payload = payload.split(remoteLink).join(encodeSlashes(encodeChars(routerBase + options.path + '/')) + name)
        count++
      })
    )
    consola.info(`nuxt-image-extractor replaced ${count} image links in this payload`)
    return payload
  }
}

/**
 * Save an asset to the filesystem
 */
async function saveRemoteImage (url, path) {
  const res = await fetch(url)
  consola.info(`nuxt-image-extractor fetching ${url}`)
  if (!res.ok) {
    consola.error(`nuxt-image-extractor failed to fetch: ${url} - Status: ${res.status}`)
    process.exit(1)
  }
  const fileStream = fs.createWriteStream(path)
  return await new Promise((resolve, reject) => {
    res.body.pipe(fileStream)
    res.body.on('error', (err) => {
      reject(err)
    })
    fileStream.on('finish', () => {
      resolve()
    })
  })
}

// https://gist.github.com/codeguy/6684588
function slugify (text) {
  return text
    .toString()
    .toLowerCase()
    .normalize('NFD')
    .trim()
    .replace('/', '')
    .replace(/\s+/g, '-')
    .replace(/[^\w-]+/g, '-')
    .replace(/--+/g, '-')
}

function removeTrailingBackslash (str) {
  return str.replace(/\\+$/, '')
}

module.exports.meta = require('../package.json')

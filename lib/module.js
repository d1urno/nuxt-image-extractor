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

module.exports = function Extract(moduleOptions) {
  const options = { ...defaults, ...moduleOptions }
  const baseDir = join(this.options.generate.dir, options.path)

  this.nuxt.hook('generate:distCopied', () => {
    if (!fs.existsSync(baseDir)) fs.mkdirSync(baseDir)
  })

  this.nuxt.hook('export:distCopied', () => {
    if (!fs.existsSync(baseDir)) fs.mkdirSync(baseDir)
  })

  this.nuxt.hook('generate:page', async (page) => {
    return await process(page)
  })

  this.nuxt.hook('export:page', async ({ page }) => {
    return await process(page)
  })

  this.nuxt.hook('export:routeCreated', ({ route }) => {
    const routePath = join(this.options.generate.dir, this.options.generate.staticAssets.versionBase, route)
    const payloadPath = join(routePath, 'payload.js')

    // Parse payload.js to get encoded URIs
    const test = new RegExp(
      '(http(s?):)([\\\\u002F|.|\\w|\\s|-]|%|~|\\\\u002F)*.(?:' + options.extensions.join('|') + '){1}[^"]*',
      'g'
    )

    const urls = []

    fs.readFile(payloadPath, 'utf8', async (err, data) => {
      if (err) return consola.error(err)
      const matches = data.matchAll(test)

      for (const match of matches) {
        const baseUrl = new URL(moduleOptions.baseUrl)
        const url = new URL(decodeURIComponent(JSON.parse('"' + removeTrailingBackslash(match[0]) + '"')))
        if (baseUrl.hostname === url.hostname && !urls.find((u) => u.href === url.href)) {
          urls.push(url)
        }
      }
      if (!urls.length) return

      await replacePayloadImageLinks(data, urls).then((payload) => {
        fs.writeFile(payloadPath, payload, 'utf8', (err) => {
          if (err) return consola.error(err)
        })
      })
    })
  })

  async function process(page) {
    const urls = []
    const test = new RegExp('(http(s?):)([/|.|\\w|\\s|-]|%|~)*.(?:' + options.extensions.join('|') + '){1}[^"]*', 'g')
    const matches = page.html.matchAll(test)
    for (const match of matches) {
      const baseUrl = new URL(moduleOptions.baseUrl)
      const url = new URL(match[0])
      if (baseUrl.hostname === url.hostname && !urls.find((u) => u.href === url.href)) {
        urls.push(url)
      }
    }
    if (!urls.length) return
    consola.info(`${page.route}: nuxt-image-extractor is replacing ${urls.length} images with local copies`)
    return await replaceRemoteImages(page.html, urls).then((html) => (page.html = html))
  }

  async function replaceRemoteImages(html, urls) {
    await Promise.all(
      urls.map(async (url) => {
        const ext = '.' + (url.pathname + url.hash).split('.').pop()
        const name = slugify((url.pathname + url.hash).split(ext).join('')) + ext
        const imgPath = join(baseDir, name)
        return await saveRemoteImage(url.href, imgPath)
          .then(() => {
            html = html.split(url.href).join(options.path + '/' + name)
          })
          .catch((e) => consola.error(e))
      })
    )
    return html
  }

  function encodeSlashes(str) {
    return str.replace(/\//g, '\\u002F')
  }

  function encodeChars(str) {
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

  async function replacePayloadImageLinks(payload, urls) {
    let count = 0
    await Promise.all(
      urls.map((url) => {
        const ext = '.' + (url.pathname + url.hash).split('.').pop()
        const preName = (url.pathname + url.hash).split(ext).join('')
        const name = slugify(encodeChars(preName)) + ext.split('?')[0]

        let remoteLink = url.href.split('.')
        remoteLink.pop()
        remoteLink = encodeSlashes(encodeChars(remoteLink.join('.'))) + ext

        payload = payload.split(remoteLink).join(encodeSlashes(encodeChars(options.path + '/')) + name)
        count++
      })
    )
    consola.info(`nuxt-image-extractor replaced ${count} image links in this payload`)
    return payload
  }
}

async function saveRemoteImage(url, path) {
  const res = await fetch(url)
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
function slugify(text) {
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

function removeTrailingBackslash(str) {
  return str.replace(/\\+$/, '')
}

module.exports.meta = require('../package.json')

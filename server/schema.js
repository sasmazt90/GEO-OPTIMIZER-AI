// JSON-LD validation against the properties Google documents for its
// structured data features. Rule-based: the same markup always gets the same
// verdict. This checks syntax and documented properties; it cannot promise
// that Google will show a rich result.
import * as cheerio from 'cheerio'

const ARTICLE = { feature: 'Article', required: [], recommended: ['headline', 'image', 'datePublished', 'dateModified', 'author'] }
const LOCAL = { feature: 'Local business', required: ['name', 'address'], recommended: ['telephone', 'url', 'openingHoursSpecification', 'geo', 'image', 'priceRange'] }
const APP = { feature: 'Software app', required: ['name', 'offers'], anyOf: [['aggregateRating', 'review']], recommended: ['applicationCategory', 'operatingSystem'] }

export const RULES = {
  Organization: { feature: 'Organization', required: ['name'], recommended: ['url', 'logo', 'sameAs', 'description', 'contactPoint', 'address'] },
  Corporation: { feature: 'Organization', required: ['name'], recommended: ['url', 'logo', 'sameAs', 'description'] },
  OnlineStore: { feature: 'Organization', required: ['name'], recommended: ['url', 'logo', 'sameAs', 'hasMerchantReturnPolicy'] },
  LocalBusiness: LOCAL, Restaurant: LOCAL, Store: LOCAL, MedicalBusiness: LOCAL, Pharmacy: LOCAL, Dentist: LOCAL, ProfessionalService: LOCAL,
  Person: { feature: 'Profile / author', required: ['name'], recommended: ['url', 'sameAs', 'jobTitle', 'image'] },
  WebSite: { feature: 'Site name', required: ['name', 'url'], recommended: ['alternateName'] },
  WebPage: { feature: null, required: [], recommended: ['name', 'description', 'dateModified'] },
  Article: ARTICLE, NewsArticle: ARTICLE, BlogPosting: ARTICLE, TechArticle: ARTICLE,
  Product: { feature: 'Product snippet / merchant listing', required: ['name'], anyOf: [['offers', 'review', 'aggregateRating']], recommended: ['image', 'description', 'brand', 'sku'] },
  Offer: { feature: null, required: ['priceCurrency'], anyOf: [['price', 'priceSpecification']], recommended: ['availability', 'url'] },
  AggregateOffer: { feature: null, required: ['lowPrice', 'priceCurrency'], recommended: ['highPrice', 'offerCount'] },
  AggregateRating: { feature: 'Review snippet', required: ['ratingValue'], anyOf: [['ratingCount', 'reviewCount']], recommended: ['bestRating'] },
  Review: { feature: 'Review snippet', required: ['author', 'reviewRating'], recommended: ['datePublished', 'itemReviewed'] },
  FAQPage: { feature: 'FAQ', required: ['mainEntity'], recommended: [], note: 'Google shows FAQ rich results only for a limited set of authoritative sites; the markup still gives answer engines clean question and answer pairs.' },
  QAPage: { feature: 'Q&A', required: ['mainEntity'], recommended: [] },
  HowTo: { feature: null, required: ['name', 'step'], recommended: ['totalTime', 'image'], note: 'Google no longer shows How-to rich results; the markup can still help answer engines parse the steps.' },
  BreadcrumbList: { feature: 'Breadcrumb', required: ['itemListElement'], recommended: [] },
  ItemList: { feature: 'Carousel', required: ['itemListElement'], recommended: [] },
  SoftwareApplication: APP, WebApplication: APP, MobileApplication: APP,
  Event: { feature: 'Event', required: ['name', 'startDate', 'location'], recommended: ['endDate', 'description', 'image', 'offers', 'eventStatus', 'organizer'] },
  VideoObject: { feature: 'Video', required: ['name', 'thumbnailUrl', 'uploadDate'], anyOf: [['contentUrl', 'embedUrl']], recommended: ['description', 'duration'] },
  Recipe: { feature: 'Recipe', required: ['name', 'image'], recommended: ['author', 'datePublished', 'description', 'recipeIngredient', 'recipeInstructions', 'totalTime', 'aggregateRating'] },
  JobPosting: { feature: 'Job posting', required: ['title', 'description', 'datePosted', 'hiringOrganization'], anyOf: [['jobLocation', 'applicantLocationRequirements']], recommended: ['validThrough', 'employmentType', 'baseSalary'] },
  Course: { feature: 'Course list', required: ['name', 'description'], recommended: ['provider'] },
}

const URL_PROPS = new Set(['url', 'logo', 'image', 'sameAs', 'thumbnailUrl', 'contentUrl', 'embedUrl', 'item', 'mainEntityOfPage'])
const DATE_PROPS = new Set(['datePublished', 'dateModified', 'uploadDate', 'startDate', 'endDate', 'datePosted', 'validThrough', 'priceValidUntil', 'dateCreated'])
const ISO_DATE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/

const list = (value) => (Array.isArray(value) ? value : value === undefined || value === null ? [] : [value])
const typesOf = (node) => list(node?.['@type']).map((type) => String(type).replace(/^https?:\/\/schema\.org\//, ''))
const isEmpty = (value) => value === undefined || value === null || (typeof value === 'string' && !value.trim()) || (Array.isArray(value) && !value.length) || (typeof value === 'object' && !Array.isArray(value) && !Object.keys(value).length)
const nameOf = (node) => String(node?.name || node?.headline || node?.title || node?.['@id'] || '').slice(0, 120)

function checkValues(node, issues, path = '') {
  for (const [key, value] of Object.entries(node)) {
    if (key.startsWith('@')) continue
    const at = path ? `${path}.${key}` : key
    if (isEmpty(value)) {
      issues.warnings.push(`"${at}" is present but empty.`)
      continue
    }
    for (const item of list(value)) {
      if (URL_PROPS.has(key) && typeof item === 'string' && !/^https?:\/\//i.test(item)) issues.warnings.push(`"${at}" should be an absolute URL (found "${item.slice(0, 80)}").`)
      if (DATE_PROPS.has(key) && typeof item === 'string' && !ISO_DATE.test(item.trim())) issues.errors.push(`"${at}" is not an ISO 8601 date (found "${item.slice(0, 40)}").`)
    }
  }
}

function checkRule(node, type, issues, path = '') {
  const rule = RULES[type]
  if (!rule) return
  const label = (prop) => (path ? `${path}.${prop}` : prop)
  for (const prop of rule.required) if (isEmpty(node[prop])) issues.errors.push(`Missing required property "${label(prop)}".`)
  for (const group of rule.anyOf || []) {
    if (group.every((prop) => isEmpty(node[prop]))) issues.errors.push(`Needs at least one of: ${group.map((prop) => `"${label(prop)}"`).join(', ')}.`)
  }
  for (const prop of rule.recommended) if (isEmpty(node[prop])) issues.warnings.push(`Recommended property "${label(prop)}" is missing.`)
}

function checkNested(node, type, issues) {
  for (const offer of list(node.offers)) {
    if (offer && typeof offer === 'object') checkRule(offer, typesOf(offer)[0] || 'Offer', issues, 'offers')
  }
  if (node.aggregateRating && typeof node.aggregateRating === 'object') checkRule(node.aggregateRating, 'AggregateRating', issues, 'aggregateRating')
  for (const review of list(node.review)) {
    if (!review || typeof review !== 'object') continue
    if (isEmpty(review.author)) issues.errors.push('Missing required property "review.author".')
    if (isEmpty(review.reviewRating?.ratingValue)) issues.errors.push('Missing required property "review.reviewRating.ratingValue".')
  }
  if (type === 'Review' && node.reviewRating && isEmpty(node.reviewRating.ratingValue)) issues.errors.push('Missing required property "reviewRating.ratingValue".')
  if (type === 'FAQPage' || type === 'QAPage') {
    const questions = list(node.mainEntity)
    questions.forEach((question, index) => {
      const at = `mainEntity[${index}]`
      if (!typesOf(question).includes('Question')) issues.errors.push(`${at} must have "@type": "Question".`)
      if (isEmpty(question?.name)) issues.errors.push(`${at} is missing the question text ("name").`)
      const answers = list(question?.acceptedAnswer).concat(type === 'QAPage' ? list(question?.suggestedAnswer) : [])
      if (!answers.length) issues.errors.push(`${at} has no "acceptedAnswer".`)
      else if (answers.some((answer) => isEmpty(answer?.text))) issues.errors.push(`${at} has an answer without "text".`)
    })
  }
  if (type === 'BreadcrumbList' || type === 'ItemList') {
    const items = list(node.itemListElement)
    items.forEach((item, index) => {
      const at = `itemListElement[${index}]`
      if (isEmpty(item?.position)) issues.errors.push(`${at} is missing "position".`)
      if (type === 'BreadcrumbList') {
        if (isEmpty(item?.name) && isEmpty(item?.item?.name)) issues.errors.push(`${at} is missing "name".`)
        if (index < items.length - 1 && isEmpty(item?.item)) issues.errors.push(`${at} is missing "item" (the URL); only the last breadcrumb may omit it.`)
      }
    })
    const positions = items.map((item) => Number(item?.position)).filter(Number.isFinite)
    if (positions.length > 1 && positions.some((position, index) => index > 0 && position <= positions[index - 1])) issues.warnings.push('"position" values should increase in order.')
  }
  if (type === 'HowTo') {
    list(node.step).forEach((step, index) => {
      if (typeof step === 'object' && isEmpty(step?.text) && isEmpty(step?.name) && isEmpty(step?.itemListElement)) issues.errors.push(`step[${index}] has no "text" or "name".`)
    })
  }
  if (type === 'Event' && typeof node.location === 'object' && !Array.isArray(node.location)) {
    const kinds = typesOf(node.location)
    if (kinds.includes('Place') && isEmpty(node.location.address)) issues.errors.push('Missing required property "location.address".')
    if (kinds.includes('VirtualLocation') && isEmpty(node.location.url)) issues.errors.push('Missing required property "location.url".')
  }
  for (const key of ['author', 'publisher', 'hiringOrganization', 'provider', 'brand']) {
    for (const entity of list(node[key])) {
      if (entity && typeof entity === 'object' && isEmpty(entity.name)) issues.warnings.push(`"${key}" should have a "name".`)
    }
  }
}

function validateNode(node, hasContext, block) {
  const types = typesOf(node)
  const issues = { errors: [], warnings: [] }
  if (!hasContext) issues.errors.push('"@context" must be "https://schema.org".')
  if (!types.length) issues.errors.push('Missing "@type".')
  const known = types.filter((type) => RULES[type])
  for (const type of known) {
    checkRule(node, type, issues)
    checkNested(node, type, issues)
  }
  checkValues(node, issues)
  const rule = RULES[known[0]]
  return {
    block,
    type: types.join(', ') || 'Unknown',
    name: nameOf(node),
    feature: rule?.feature || null,
    known: known.length > 0,
    note: rule?.note || (types.length && !known.length ? 'No Google rule set for this type: syntax and value formats were checked only.' : ''),
    properties: Object.keys(node).filter((key) => !key.startsWith('@')).length,
    errors: [...new Set(issues.errors)],
    warnings: [...new Set(issues.warnings)],
    status: issues.errors.length ? 'fail' : issues.warnings.length ? 'warn' : 'pass',
  }
}

function contextOk(context) {
  return list(context).some((entry) => (typeof entry === 'string' ? /^https?:\/\/(www\.)?schema\.org\/?$/i.test(entry.trim()) : /schema\.org/i.test(String(entry?.['@vocab'] || ''))))
}

// blocks: array of raw JSON strings (one per <script type="application/ld+json">).
export function validateBlocks(blocks) {
  const items = []
  const parseErrors = []
  blocks.forEach((raw, index) => {
    const text = String(raw || '').trim()
    if (!text) return parseErrors.push({ block: index + 1, message: 'The JSON-LD block is empty.' })
    let data
    try {
      data = JSON.parse(text)
    } catch (error) {
      return parseErrors.push({ block: index + 1, message: `Invalid JSON: ${String(error.message).slice(0, 160)}` })
    }
    for (const root of list(data)) {
      if (!root || typeof root !== 'object') {
        parseErrors.push({ block: index + 1, message: 'A JSON-LD block must contain an object or an array of objects.' })
        continue
      }
      const hasContext = contextOk(root['@context'])
      const nodes = Array.isArray(root['@graph']) ? root['@graph'] : [root]
      for (const node of nodes) if (node && typeof node === 'object') items.push(validateNode(node, hasContext, index + 1))
    }
  })
  const counts = { pass: items.filter((item) => item.status === 'pass').length, warn: items.filter((item) => item.status === 'warn').length, fail: items.filter((item) => item.status === 'fail').length + parseErrors.length }
  return {
    blocks: blocks.length,
    items,
    parseErrors,
    counts,
    types: [...new Set(items.flatMap((item) => item.type.split(', ')))].filter((type) => type !== 'Unknown'),
    features: [...new Set(items.filter((item) => item.feature && item.status !== 'fail').map((item) => item.feature))],
    method: 'Rule-based check of JSON syntax, schema.org context, value formats and the required and recommended properties Google documents for each type. Microdata and RDFa are not read. Passing does not guarantee a rich result.',
  }
}

export function jsonLdBlocksFromHtml(html) {
  const $ = cheerio.load(String(html || ''))
  return $('script[type="application/ld+json"]').map((_, element) => $(element).contents().text()).get()
}

// Accepts raw JSON-LD or an HTML snippet containing <script type="application/ld+json"> tags.
export function blocksFromInput(code) {
  const text = String(code || '').trim()
  return /<script/i.test(text) ? jsonLdBlocksFromHtml(text) : [text]
}

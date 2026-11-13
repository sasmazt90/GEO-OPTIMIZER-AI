// JSON-LD templates for the schema generator. Empty fields are left out of the output.
const lines = (value) => String(value || '').split('\n').map((item) => item.trim()).filter(Boolean)
const prune = (value) => {
  if (Array.isArray(value)) {
    const items = value.map(prune).filter((item) => item !== undefined)
    return items.length ? items : undefined
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value).map(([key, item]) => [key, prune(item)]).filter(([, item]) => item !== undefined)
    return entries.some(([key]) => !key.startsWith('@')) ? Object.fromEntries(entries) : undefined
  }
  return value === '' || value === null || value === undefined ? undefined : value
}
const number = (value) => (value === '' || Number.isNaN(Number(value)) ? '' : Number(value))
const pairs = (value) => lines(value).map((line) => line.split('|').map((part) => part.trim()))

export const TEMPLATES = [
  {
    id: 'Organization', label: 'Organization',
    fields: [['name', 'Name', 'Acme GmbH'], ['url', 'Website', 'https://example.com'], ['logo', 'Logo URL', 'https://example.com/logo.png'], ['description', 'Description', '', 'textarea'], ['sameAs', 'Profile URLs (one per line)', 'https://www.linkedin.com/company/acme', 'textarea'], ['email', 'Contact email', 'hello@example.com'], ['telephone', 'Phone', '+49 89 1234567']],
    build: (v) => ({ '@type': 'Organization', name: v.name, url: v.url, logo: v.logo, description: v.description, sameAs: lines(v.sameAs), contactPoint: { '@type': 'ContactPoint', contactType: 'customer service', email: v.email, telephone: v.telephone } }),
  },
  {
    id: 'LocalBusiness', label: 'Local business',
    fields: [['name', 'Name', 'Acme Store'], ['url', 'Website', 'https://example.com'], ['telephone', 'Phone', '+49 89 1234567'], ['image', 'Image URL', 'https://example.com/store.jpg'], ['street', 'Street address', 'Marienplatz 1'], ['city', 'City', 'Munich'], ['postalCode', 'Postal code', '80331'], ['country', 'Country code', 'DE'], ['priceRange', 'Price range', '€€'], ['hours', 'Opening hours (Days|opens|closes per line)', 'Monday,Tuesday,Wednesday,Thursday,Friday|09:00|18:00', 'textarea']],
    build: (v) => ({ '@type': 'LocalBusiness', name: v.name, url: v.url, telephone: v.telephone, image: v.image, priceRange: v.priceRange, address: { '@type': 'PostalAddress', streetAddress: v.street, addressLocality: v.city, postalCode: v.postalCode, addressCountry: v.country }, openingHoursSpecification: pairs(v.hours).map(([days, opens, closes]) => ({ '@type': 'OpeningHoursSpecification', dayOfWeek: String(days || '').split(',').map((day) => day.trim()).filter(Boolean), opens, closes })) }),
  },
  {
    id: 'Product', label: 'Product',
    fields: [['name', 'Name', 'Acme CRM Pro'], ['description', 'Description', '', 'textarea'], ['image', 'Image URL', 'https://example.com/product.jpg'], ['brand', 'Brand', 'Acme'], ['sku', 'SKU', 'ACME-PRO'], ['price', 'Price', '49.00'], ['currency', 'Currency', 'EUR'], ['availability', 'Availability', 'InStock'], ['url', 'Product URL', 'https://example.com/product'], ['ratingValue', 'Average rating', '4.6'], ['reviewCount', 'Number of reviews', '128']],
    build: (v) => ({ '@type': 'Product', name: v.name, description: v.description, image: v.image, sku: v.sku, brand: { '@type': 'Brand', name: v.brand }, offers: { '@type': 'Offer', price: v.price, priceCurrency: v.currency, availability: v.availability ? `https://schema.org/${v.availability}` : '', url: v.url }, aggregateRating: v.ratingValue ? { '@type': 'AggregateRating', ratingValue: number(v.ratingValue), reviewCount: number(v.reviewCount) } : undefined }),
  },
  {
    id: 'Article', label: 'Article',
    fields: [['headline', 'Headline', 'How to choose a CRM'], ['image', 'Image URL', 'https://example.com/article.jpg'], ['datePublished', 'Published (YYYY-MM-DD)', '2026-11-13'], ['dateModified', 'Last modified (YYYY-MM-DD)', '2026-11-13'], ['authorName', 'Author name', 'Jane Doe'], ['authorUrl', 'Author profile URL', 'https://example.com/authors/jane'], ['publisher', 'Publisher', 'Acme'], ['publisherLogo', 'Publisher logo URL', 'https://example.com/logo.png']],
    build: (v) => ({ '@type': 'Article', headline: v.headline, image: v.image, datePublished: v.datePublished, dateModified: v.dateModified, author: { '@type': 'Person', name: v.authorName, url: v.authorUrl }, publisher: { '@type': 'Organization', name: v.publisher, logo: { '@type': 'ImageObject', url: v.publisherLogo } } }),
  },
  {
    id: 'FAQPage', label: 'FAQ',
    fields: [['faq', 'Questions (Question|Answer per line)', 'What is Acme?|Acme is a CRM for sales teams.', 'textarea']],
    build: (v) => ({ '@type': 'FAQPage', mainEntity: pairs(v.faq).filter(([question, answer]) => question && answer).map(([question, answer]) => ({ '@type': 'Question', name: question, acceptedAnswer: { '@type': 'Answer', text: answer } })) }),
  },
  {
    id: 'BreadcrumbList', label: 'Breadcrumb',
    fields: [['crumbs', 'Breadcrumbs (Name|URL per line, in order)', 'Home|https://example.com/\nPricing|https://example.com/pricing', 'textarea']],
    build: (v) => ({ '@type': 'BreadcrumbList', itemListElement: pairs(v.crumbs).filter(([name]) => name).map(([name, item], index) => ({ '@type': 'ListItem', position: index + 1, name, item })) }),
  },
  {
    id: 'SoftwareApplication', label: 'Software app',
    fields: [['name', 'Name', 'Acme CRM'], ['category', 'Application category', 'BusinessApplication'], ['os', 'Operating system', 'Web'], ['price', 'Price (0 for free)', '0'], ['currency', 'Currency', 'EUR'], ['ratingValue', 'Average rating', '4.7'], ['ratingCount', 'Number of ratings', '312']],
    build: (v) => ({ '@type': 'SoftwareApplication', name: v.name, applicationCategory: v.category, operatingSystem: v.os, offers: { '@type': 'Offer', price: v.price, priceCurrency: v.currency }, aggregateRating: v.ratingValue ? { '@type': 'AggregateRating', ratingValue: number(v.ratingValue), ratingCount: number(v.ratingCount) } : undefined }),
  },
  {
    id: 'Person', label: 'Person / author',
    fields: [['name', 'Name', 'Jane Doe'], ['jobTitle', 'Job title', 'Head of Research'], ['url', 'Profile URL', 'https://example.com/authors/jane'], ['image', 'Photo URL', 'https://example.com/jane.jpg'], ['worksFor', 'Organization', 'Acme'], ['sameAs', 'Profile URLs (one per line)', 'https://www.linkedin.com/in/janedoe', 'textarea']],
    build: (v) => ({ '@type': 'Person', name: v.name, jobTitle: v.jobTitle, url: v.url, image: v.image, worksFor: { '@type': 'Organization', name: v.worksFor }, sameAs: lines(v.sameAs) }),
  },
  {
    id: 'Event', label: 'Event',
    fields: [['name', 'Name', 'Acme Summit 2027'], ['startDate', 'Start (YYYY-MM-DDTHH:MM+01:00)', '2027-03-10T09:00+01:00'], ['endDate', 'End', '2027-03-10T17:00+01:00'], ['venue', 'Venue name', 'ICM Munich'], ['address', 'Venue address', 'Messegelände, 81823 Munich, DE'], ['description', 'Description', '', 'textarea'], ['image', 'Image URL', 'https://example.com/event.jpg'], ['organizer', 'Organizer', 'Acme'], ['ticketUrl', 'Ticket URL', 'https://example.com/tickets'], ['price', 'Ticket price', '199'], ['currency', 'Currency', 'EUR']],
    build: (v) => ({ '@type': 'Event', name: v.name, startDate: v.startDate, endDate: v.endDate, description: v.description, image: v.image, eventStatus: 'https://schema.org/EventScheduled', location: { '@type': 'Place', name: v.venue, address: v.address }, organizer: { '@type': 'Organization', name: v.organizer }, offers: { '@type': 'Offer', url: v.ticketUrl, price: v.price, priceCurrency: v.currency } }),
  },
  {
    id: 'VideoObject', label: 'Video',
    fields: [['name', 'Title', 'Acme CRM in 3 minutes'], ['description', 'Description', '', 'textarea'], ['thumbnailUrl', 'Thumbnail URL', 'https://example.com/thumb.jpg'], ['uploadDate', 'Upload date (YYYY-MM-DD)', '2026-11-13'], ['duration', 'Duration (ISO 8601, e.g. PT3M10S)', 'PT3M10S'], ['contentUrl', 'Video file URL', 'https://example.com/video.mp4'], ['embedUrl', 'Embed URL', 'https://www.youtube.com/embed/abc123']],
    build: (v) => ({ '@type': 'VideoObject', name: v.name, description: v.description, thumbnailUrl: v.thumbnailUrl, uploadDate: v.uploadDate, duration: v.duration, contentUrl: v.contentUrl, embedUrl: v.embedUrl }),
  },
]

export function buildJsonLd(template, values) {
  const body = prune(template.build(values)) || { '@type': template.id }
  return JSON.stringify({ '@context': 'https://schema.org', ...body }, null, 2)
}

export const asScriptTag = (json) => `<script type="application/ld+json">\n${json}\n</script>`

// Helper function to parse WooCommerce product attributes from serialized PHP data
function parseProductAttributes(serializedData, terms) {
    const attributes = [];

    if (!serializedData) return attributes;

    try {
        // Pattern matches: s:7:"pa_size";a:6:{...}
        const attrPattern = /s:\d+:"(pa_[^"]+)";a:\d+:\{([^}]+(?:\{[^}]*\}[^}]*)*)\}/g;
        let match;

        while ((match = attrPattern.exec(serializedData)) !== null) {
            const attrSlug = match[1];
            const attrBlock = match[2];

            // Extract is_visible and is_variation flags
            const visibleMatch = attrBlock.match(/s:10:"is_visible";i:(\d)/);
            const variationMatch = attrBlock.match(/s:12:"is_variation";i:(\d)/);

            const isVisible = visibleMatch ? visibleMatch[1] === '1' : true;
            const isVariation = variationMatch ? variationMatch[1] === '1' : false;

            // Get the attribute terms from the already-fetched terms
            const attrTerms = terms.filter(t => t.taxonomy === attrSlug);

            // Generate a readable name from slug
            const attrName = attrSlug.replace('pa_', '').replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());

            attributes.push({
                slug: attrSlug,
                name: attrName,
                terms: attrTerms,
                isVisible,
                isVariation
            });
        }
    } catch (e) {
        console.error('Error parsing attributes:', e);
    }

    return attributes;
}

module.exports = { parseProductAttributes };

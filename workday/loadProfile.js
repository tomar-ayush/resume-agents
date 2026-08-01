// Profile helpers for Workday applications.
// - Loads candidate data from the local information.js file.
// - Validates that required fields are present and non-empty.

const localProfile = require('../information');

// Fields that MUST be present and non-empty (accepts both camelCase and snake_case).
const REQUIRED_FIELDS = ['email', 'password'];
const REQUIRED_FIELDS_CAMEL = ['firstName', 'lastName'];

function isNonEmpty(value) {
    if (value === null || value === undefined) return false;
    if (typeof value === 'string') return value.trim().length > 0;
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === 'object') return Object.keys(value).length > 0;
    return true;
}

// Load the candidate profile from the local information.js file.
function loadLocalProfile() {
    return localProfile;
}

// Validate that required fields are present and non-empty.
// Accepts both camelCase (reference convention) and snake_case keys.
function validateWorkdayProfile(profile) {
    const missing = [];
    for (const field of REQUIRED_FIELDS) {
        if (!isNonEmpty(profile[field])) missing.push(field);
    }
    for (const field of REQUIRED_FIELDS_CAMEL) {
        if (!isNonEmpty(profile[field])) missing.push(field);
    }
    const errors = missing.map((field) => `Missing or empty required field: ${field}`);
    return { valid: missing.length === 0, errors, missing };
}

module.exports = {
    REQUIRED_FIELDS,
    isNonEmpty,
    loadLocalProfile,
    validateWorkdayProfile,
};

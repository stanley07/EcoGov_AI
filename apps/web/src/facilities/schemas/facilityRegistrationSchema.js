export function validateRegistrationForm(data) {
    const errors = {};
    if (!data.businessName || data.businessName.trim().length < 2) {
        errors.businessName = "Business name must be at least 2 characters.";
    }
    if (!data.category) {
        errors.category = "Category is required.";
    }
    if (!data.address || data.address.trim().length < 5) {
        errors.address = "Address must be at least 5 characters.";
    }
    if (!data.town || data.town.trim().length < 2) {
        errors.town = "Town/City is required.";
    }
    if (!data.lga || data.lga.trim().length < 2) {
        errors.lga = "Local Government Area (LGA) is required.";
    }
    if (!data.contactPerson || data.contactPerson.trim().length < 2) {
        errors.contactPerson = "Contact person is required.";
    }
    if (!data.contactEmail && !data.contactPhone) {
        errors.contactInfo = "Either contact email or contact phone must be provided.";
    }
    if (data.contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.contactEmail)) {
        errors.contactEmail = "Invalid email format.";
    }
    if (data.contactPhone && !/^\+?[0-9\s\-()]{7,20}$/.test(data.contactPhone)) {
        errors.contactPhone = "Invalid phone number format.";
    }
    if (data.latitude === undefined || isNaN(data.latitude) || data.latitude < -90 || data.latitude > 90) {
        errors.latitude = "Latitude must be between -90 and 90.";
    }
    if (data.longitude === undefined || isNaN(data.longitude) || data.longitude < -180 || data.longitude > 180) {
        errors.longitude = "Longitude must be between -180 and 180.";
    }
    return errors;
}
//# sourceMappingURL=facilityRegistrationSchema.js.map
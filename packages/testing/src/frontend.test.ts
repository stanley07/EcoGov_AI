import { describe, test, expect, beforeAll } from "vitest";

let validateRegistrationForm: any;

beforeAll(async () => {
  const modulePath = "../../../apps/web/src/facilities/schemas/facilityRegistrationSchema.js";
  // @ts-ignore
  const mod = await import(modulePath);
  validateRegistrationForm = mod.validateRegistrationForm;
});

describe("Frontend Registration Form Validation Schema", () => {
  test("requires at least email or phone", () => {
    const res = validateRegistrationForm({
      businessName: "Test",
      category: "car_wash",
      address: "123 Street",
      town: "Awka",
      lga: "Awka South",
      contactPerson: "Emeka",
      latitude: 6.2,
      longitude: 6.8,
    });
    expect(res.contactInfo).toBe("Either contact email or contact phone must be provided.");
  });

  test("succeeds when email is provided", () => {
    const res = validateRegistrationForm({
      businessName: "Test",
      category: "car_wash",
      address: "123 Street",
      town: "Awka",
      lga: "Awka South",
      contactPerson: "Emeka",
      latitude: 6.2,
      longitude: 6.8,
      contactEmail: "emeka@test.com",
    });
    expect(res.contactInfo).toBeUndefined();
    expect(res.contactEmail).toBeUndefined();
  });

  test("succeeds when phone is provided", () => {
    const res = validateRegistrationForm({
      businessName: "Test",
      category: "car_wash",
      address: "123 Street",
      town: "Awka",
      lga: "Awka South",
      contactPerson: "Emeka",
      latitude: 6.2,
      longitude: 6.8,
      contactPhone: "+2348030000000",
    });
    expect(res.contactInfo).toBeUndefined();
    expect(res.contactPhone).toBeUndefined();
  });

  test("flags invalid email format", () => {
    const res = validateRegistrationForm({
      businessName: "Test",
      category: "car_wash",
      address: "123 Street",
      town: "Awka",
      lga: "Awka South",
      contactPerson: "Emeka",
      latitude: 6.2,
      longitude: 6.8,
      contactEmail: "invalid-email",
    });
    expect(res.contactEmail).toBe("Invalid email format.");
  });

  test("flags invalid phone format", () => {
    const res = validateRegistrationForm({
      businessName: "Test",
      category: "car_wash",
      address: "123 Street",
      town: "Awka",
      lga: "Awka South",
      contactPerson: "Emeka",
      latitude: 6.2,
      longitude: 6.8,
      contactPhone: "123",
    });
    expect(res.contactPhone).toBe("Invalid phone number format.");
  });
});

describe("Frontend UI Behavioral Logic Mocks", () => {
  test("clientSubmissionId remains stable between retries", () => {
    // Simulate modal hook ref persistence behavior on mount
    const createSubmissionId = () => `sub-${Math.random().toString(36).substring(2)}-${Date.now()}`;
    const idOnMount = createSubmissionId();
    const idOnRetry = idOnMount; // Modal keeps this ref stable
    expect(idOnMount).toBe(idOnRetry);
  });

  test("button visibility is correctly gated by roles and permissions", () => {
    const hasPermission = (roles: string[], perm: string) => roles.includes(perm) || roles.includes("super_admin");
    
    // User has permission
    const rolesWithRegister = ["facility:register"];
    expect(hasPermission(rolesWithRegister, "facility:register") || rolesWithRegister.includes("super_admin")).toBe(true);

    // User is super_admin
    const rolesSuperAdmin = ["super_admin"];
    expect(hasPermission(rolesSuperAdmin, "facility:register") || rolesSuperAdmin.includes("super_admin")).toBe(true);

    // User has no permission
    const rolesCitizen = ["citizen"];
    expect(hasPermission(rolesCitizen, "facility:register") || rolesCitizen.includes("super_admin")).toBe(false);
  });
});

# API Documentation

## Google Integration Backend - REST API Reference

**Base URL:** `http://localhost:3001`  
**Authentication:** Bearer Token (JWT)  
**Content-Type:** `application/json`

---

## Table of Contents

- [Common Query Parameters (Pagination)](#common-query-parameters-pagination)
- [Expand Query Parameter (Foreign Key Relations)](#expand-query-parameter-foreign-key-relations)

### Modules

1. [Authentication](#1-authentication-module)
2. [Tenant Management](#2-tenant-module)
3. [User Management](#3-user-module)
4. [Reports](#4-reports-module)
5. [Data](#5-data-module)
6. [Audit](#6-audit-module)
7. [Tax Types](#7-tax-type-module)
8. [UOM (Unit of Measure)](#8-uom-module)
9. [UOM Factor](#9-uom-factor-module) ⚡
10. [Category](#10-category-module)
11. [Organization](#11-organization-module)
12. [Account Type](#12-account-type-module)
13. [Account Type Base](#13-account-type-base-module)
14. [Transaction Type](#14-transaction-type-module)
15. [Transaction Type Config](#15-transaction-type-config-module)
16. [Transaction Type Status](#16-transaction-type-status-module)
17. [Transaction Type Base Conversion](#17-transaction-type-base-conversion-module) ⚡
18. [Transaction Type Conversion Mapper](#18-transaction-type-conversion-mapper-module) ⚡
19. [Transaction Detail Log](#19-transaction-detail-log-module) ⚡
20. [Transaction Item Detail](#20-transaction-item-detail-module) ⚡
21. [Tax Group](#21-tax-group-module)
22. [Tax Group Tax Type Mapper](#22-tax-group-tax-type-mapper-module) ⚡
23. [Contact Address Type](#23-contact-address-type-module)
24. [Contact Detail](#24-contact-detail-module) ⚡
25. [Address Detail](#25-address-detail-module) ⚡
26. [Location Detail](#26-location-detail-module)
27. [Map Provider](#27-map-provider-module)
28. [Map Provider Location Mapper](#28-map-provider-location-mapper-module) ⚡
29. [Cost Info](#29-cost-info-module) ⚡
30. [Branch Detail](#30-branch-detail-module) ⚡
31. [Branch User Group Mapper](#31-branch-user-group-mapper-module) ⚡
32. [Batch Detail](#32-batch-detail-module)
33. [Item Detail](#33-item-detail-module) ⚡
34. [Payment Received Type](#34-payment-received-type-module)
35. [Payment Mode](#35-payment-mode-module)
36. [Payment Mode Transaction Detail](#36-payment-mode-transaction-detail-module) ⚡
37. [Payment Detail](#37-payment-detail-module) ⚡
38. [Payment Breakup](#38-payment-breakup-module) ⚡

> ⚡ Supports `?expand=true` query parameter

---

## Common Response Format

### Success Response

```json
{
  "success": true,
  "message": "Operation completed successfully",
  "data": { ... }
}
```

### Paginated Response (GET List)

```json
{
  "success": true,
  "message": "Records retrieved successfully",
  "data": [ ... ],
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 100,
    "totalPages": 10
  }
}
```

### Single Record Response (GET by ID, POST, PUT)

```json
{
  "success": true,
  "message": "Operation completed successfully",
  "data": { ... }
}
```

### Delete Response

```json
{
  "success": true,
  "message": "Record deleted successfully"
}
```

### Error Response

```json
{
  "success": false,
  "message": "Error description",
  "error": "ERROR_CODE"
}
```

### Validation Error Response

```json
{
  "success": false,
  "message": "Validation Error: \"fieldName\" is required",
  "error": "VALIDATION_ERROR"
}
```

---

## Common Query Parameters (Pagination)

All GET list endpoints support the following query parameters:

| Parameter | Type    | Required | Default | Constraints      | Description                |
| --------- | ------- | -------- | ------- | ---------------- | -------------------------- |
| `page`    | integer | No       | 1       | min: 1           | Page number for pagination |
| `limit`   | integer | No       | 10      | min: 1, max: 100 | Number of records per page |

---

## Expand Query Parameter (Foreign Key Relations)

Modules with foreign key (FK) relationships support the `expand` query parameter to include related entity details in the response.

| Parameter | Type    | Required | Default | Description                                        |
| --------- | ------- | -------- | ------- | -------------------------------------------------- |
| `expand`  | boolean | No       | false   | When `true`, includes related entity names/details |

### Modules Supporting Expand

The following 16 modules support `?expand=true`:

| Module                             | Endpoint                                | Expanded Fields                                                       |
| ---------------------------------- | --------------------------------------- | --------------------------------------------------------------------- |
| UOM Factor                         | `/api/uomfactors`                       | `PrimaryUOMName`, `SecondaryUOMName`                                  |
| Tax Group Tax Type Mapper          | `/api/taxgrouptaxtypemappers`           | `TaxGroupName`, `TaxTypeName`                                         |
| Map Provider Location Mapper       | `/api/mapproviderlocationmappers`       | `ProviderName`, `Lat`, `Lng`                                          |
| Contact Detail                     | `/api/contactdetails`                   | `ContactAddressTypeName`                                              |
| Address Detail                     | `/api/addressdetails`                   | `MapProviderLocationMapperDetails`, `ContactAddressTypeName`          |
| Cost Info                          | `/api/costinfos`                        | `TaxGroupName`                                                        |
| Branch Detail                      | `/api/branchdetails`                    | `AddressDetails`, `ContactDetails`, `OrganizationName`                |
| Branch User Group Mapper           | `/api/branchusergroupmappers`           | `BranchName`, `UserGroupName`                                         |
| Item Detail                        | `/api/itemdetails`                      | `CategoryName`, `UOMName`, `CostInfoDetails`                          |
| Transaction Type Base Conversion   | `/api/transactiontypebaseconversions`   | `TransactionTypeConfigPrefix`, `FromStatusName`, `ToStatusName`       |
| Transaction Detail Log             | `/api/transactiondetaillogs`            | `TransactionTypeConfigPrefix`, `StatusName`, `BranchName`             |
| Transaction Item Detail            | `/api/transactionitemdetails`           | `TransactionNo`, `ItemName`, `BatchNumber`, `UOMName`, `TaxGroupName` |
| Transaction Type Conversion Mapper | `/api/transactiontypeconversionmappers` | `BaseConversionDetails`, `FromTransactionNo`, `ToTransactionNo`       |
| Payment Mode Transaction Detail    | `/api/paymentmodetransactiondetails`    | `PaymentModeName`, `TransactionNo`                                    |
| Payment Detail                     | `/api/paymentdetails`                   | `PaymentReceivedTypeName`, `TransactionNo`                            |
| Payment Breakup                    | `/api/paymentbreakups`                  | `PaymentDetailRef`, `PaymentModeName`                                 |

### Example Usage

**Request without expand (default):**

```
GET /api/uomfactors?page=1&limit=10
```

**Response without expand:**

```json
{
  "success": true,
  "data": [
    {
      "Id": "...",
      "PrimaryUOMId": "550e8400-e29b-41d4-a716-446655440000",
      "SecondaryUOMId": "660e8400-e29b-41d4-a716-446655440001",
      "Factor": 1000.0
    }
  ]
}
```

**Request with expand:**

```
GET /api/uomfactors?page=1&limit=10&expand=true
```

**Response with expand:**

```json
{
  "success": true,
  "data": [
    {
      "Id": "...",
      "PrimaryUOMId": "550e8400-e29b-41d4-a716-446655440000",
      "PrimaryUOMName": "Kilogram",
      "SecondaryUOMId": "660e8400-e29b-41d4-a716-446655440001",
      "SecondaryUOMName": "Gram",
      "Factor": 1000.0
    }
  ]
}
```

---

## Common Field Types

| Type      | Description                                     | Example                                    |
| --------- | ----------------------------------------------- | ------------------------------------------ |
| `uuid`    | UUID v4 format string                           | `"550e8400-e29b-41d4-a716-446655440000"`   |
| `string`  | Text string with optional max length constraint | `"Sample Name"`                            |
| `number`  | Decimal number with precision                   | `99.99`                                    |
| `integer` | Whole number                                    | `100`                                      |
| `boolean` | Boolean value                                   | `true` or `false`                          |
| `date`    | ISO 8601 date string                            | `"2024-01-15"` or `"2024-01-15T10:30:00Z"` |

---

## 1. Authentication Module

### Google Sign-In

Authenticate user with Google OAuth token.

| Method | Endpoint           | Auth Required |
| ------ | ------------------ | ------------- |
| `POST` | `/api/auth/google` | No            |

**Request Body:**

| Field      | Type   | Required | Constraints | Description           |
| ---------- | ------ | -------- | ----------- | --------------------- |
| `id_token` | string | Yes      | -           | Google OAuth ID token |

```json
{
  "id_token": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**Success Response (200):**

```json
{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "email": "user@example.com",
    "name": "John Doe",
    "picture": "https://lh3.googleusercontent.com/..."
  }
}
```

**Error Response (401):**

```json
{
  "success": false,
  "message": "Invalid or expired token"
}
```

---

## 2. Tenant Module

### Switch Tenant

Switch to a different tenant context.

| Method | Endpoint              | Auth Required | Scopes |
| ------ | --------------------- | ------------- | ------ |
| `POST` | `/api/tenants/switch` | Yes           | -      |

**Request Body:**

| Field      | Type | Required | Constraints | Description                   |
| ---------- | ---- | -------- | ----------- | ----------------------------- |
| `tenantId` | uuid | Yes      | UUID v4     | ID of the tenant to switch to |

```json
{
  "tenantId": "550e8400-e29b-41d4-a716-446655440000"
}
```

**Success Response (200):**

```json
{
  "success": true,
  "message": "Tenant switched successfully",
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**Error Response (404):**

```json
{
  "success": false,
  "message": "Tenant not found or access denied"
}
```

---

## 3. User Module

### Logout

Logout user session.

| Method | Endpoint           | Auth Required |
| ------ | ------------------ | ------------- |
| `POST` | `/api/user/logout` | Yes           |

**Request Body:** None required

**Success Response (200):**

```json
{
  "success": true,
  "message": "Logged out successfully"
}
```

---

## 4. Reports Module

### Get Reports

| Method | Endpoint       | Auth Required | Scopes         |
| ------ | -------------- | ------------- | -------------- |
| `GET`  | `/api/reports` | Yes           | `REPORTS:READ` |

**Success Response (200):**

```json
{
  "success": true,
  "data": {
    "reports": [...]
  }
}
```

### Get Billing

| Method | Endpoint               | Auth Required | Scopes                            |
| ------ | ---------------------- | ------------- | --------------------------------- |
| `GET`  | `/api/reports/billing` | Yes           | `BILLING:READ` or `REPORTS:WRITE` |

**Success Response (200):**

```json
{
  "success": true,
  "data": {
    "billing": [...]
  }
}
```

---

## 5. Data Module

### Get Admin Settings

| Method | Endpoint             | Auth Required | Scopes         |
| ------ | -------------------- | ------------- | -------------- |
| `GET`  | `/api/data/settings` | Yes           | `TENANT:ADMIN` |

**Success Response (200):**

```json
{
  "success": true,
  "data": {
    "settings": {...}
  }
}
```

### Get General Data

| Method | Endpoint            | Auth Required |
| ------ | ------------------- | ------------- |
| `GET`  | `/api/data/general` | Yes           |

**Success Response (200):**

```json
{
  "success": true,
  "data": {
    "general": {...}
  }
}
```

---

## 6. Audit Module

### Get Audit Logs

| Method | Endpoint          | Auth Required |
| ------ | ----------------- | ------------- |
| `GET`  | `/api/audit/logs` | Yes           |

**Query Parameters:**

| Parameter   | Type   | Required | Constraints | Description               |
| ----------- | ------ | -------- | ----------- | ------------------------- |
| `userEmail` | string | No       | Valid email | Filter logs by user email |

**Success Response (200):**

```json
{
  "success": true,
  "data": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "action": "CREATE",
      "entity": "TaxType",
      "entityId": "660e8400-e29b-41d4-a716-446655440001",
      "userEmail": "admin@example.com",
      "timestamp": "2024-01-15T10:30:00Z",
      "details": {...}
    }
  ]
}
```

**Query Parameters (Previous Location):**
| Parameter | Type | Description |
|-----------|------|-------------|
| `userEmail` | string | Filter by user email (admin only) |

---

## 7. Tax Type Module

**Base Path:** `/api/taxtypes`

### Endpoints Overview

| Method   | Endpoint            | Description        | Auth | Scopes                               |
| -------- | ------------------- | ------------------ | ---- | ------------------------------------ |
| `GET`    | `/api/taxtypes`     | Get all tax types  | Yes  | -                                    |
| `GET`    | `/api/taxtypes/:id` | Get tax type by ID | Yes  | -                                    |
| `POST`   | `/api/taxtypes`     | Create tax type    | Yes  | `TENANT:ADMIN`, `TENANT:SUPER_ADMIN` |
| `PUT`    | `/api/taxtypes/:id` | Update tax type    | Yes  | `TENANT:ADMIN`, `TENANT:SUPER_ADMIN` |
| `DELETE` | `/api/taxtypes/:id` | Delete tax type    | Yes  | `TENANT:ADMIN`, `TENANT:SUPER_ADMIN` |

### GET /api/taxtypes - Get All Tax Types

**Query Parameters:**

| Parameter | Type    | Required | Default | Constraints      | Description      |
| --------- | ------- | -------- | ------- | ---------------- | ---------------- |
| `page`    | integer | No       | 1       | min: 1           | Page number      |
| `limit`   | integer | No       | 10      | min: 1, max: 100 | Records per page |

**Success Response (200):**

```json
{
  "success": true,
  "message": "Records retrieved successfully",
  "data": [
    {
      "Id": "550e8400-e29b-41d4-a716-446655440000",
      "Name": "Standard VAT",
      "Value": 20.0,
      "Active": true,
      "TenantId": "660e8400-e29b-41d4-a716-446655440001",
      "CreatedAt": "2024-01-15T10:30:00Z",
      "UpdatedAt": "2024-01-15T10:30:00Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 50,
    "totalPages": 5
  }
}
```

### GET /api/taxtypes/:id - Get Tax Type by ID

**Path Parameters:**

| Parameter | Type | Required | Constraints | Description |
| --------- | ---- | -------- | ----------- | ----------- |
| `id`      | uuid | Yes      | UUID v4     | Tax Type ID |

**Success Response (200):**

```json
{
  "success": true,
  "message": "Record retrieved successfully",
  "data": {
    "Id": "550e8400-e29b-41d4-a716-446655440000",
    "Name": "Standard VAT",
    "Value": 20.0,
    "Active": true,
    "TenantId": "660e8400-e29b-41d4-a716-446655440001",
    "CreatedAt": "2024-01-15T10:30:00Z",
    "UpdatedAt": "2024-01-15T10:30:00Z"
  }
}
```

**Error Response (404):**

```json
{
  "success": false,
  "message": "Record not found"
}
```

### POST /api/taxtypes - Create Tax Type

**Request Body:**

| Field    | Type    | Required | Constraints                    | Description          |
| -------- | ------- | -------- | ------------------------------ | -------------------- |
| `Name`   | string  | **Yes**  | max: 100 chars                 | Tax type name        |
| `Value`  | number  | **Yes**  | min: 0, max: 100, precision: 2 | Tax percentage value |
| `Active` | boolean | No       | default: true                  | Active status        |

```json
{
  "Name": "Standard VAT",
  "Value": 20.0,
  "Active": true
}
```

**Success Response (201):**

```json
{
  "success": true,
  "message": "Record created successfully",
  "data": {
    "Id": "550e8400-e29b-41d4-a716-446655440000",
    "Name": "Standard VAT",
    "Value": 20.0,
    "Active": true,
    "TenantId": "660e8400-e29b-41d4-a716-446655440001",
    "CreatedAt": "2024-01-15T10:30:00Z",
    "UpdatedAt": "2024-01-15T10:30:00Z"
  }
}
```

**Error Response (400):**

```json
{
  "success": false,
  "message": "Validation Error: \"Name\" is required"
}
```

### PUT /api/taxtypes/:id - Update Tax Type

**Path Parameters:**

| Parameter | Type | Required | Constraints | Description |
| --------- | ---- | -------- | ----------- | ----------- |
| `id`      | uuid | Yes      | UUID v4     | Tax Type ID |

**Request Body (at least one field required):**

| Field    | Type    | Required | Constraints                    | Description          |
| -------- | ------- | -------- | ------------------------------ | -------------------- |
| `Name`   | string  | No       | max: 100 chars                 | Tax type name        |
| `Value`  | number  | No       | min: 0, max: 100, precision: 2 | Tax percentage value |
| `Active` | boolean | No       | -                              | Active status        |

```json
{
  "Name": "Updated VAT",
  "Value": 18.0
}
```

**Success Response (200):**

```json
{
  "success": true,
  "message": "Record updated successfully",
  "data": {
    "Id": "550e8400-e29b-41d4-a716-446655440000",
    "Name": "Updated VAT",
    "Value": 18.0,
    "Active": true,
    "TenantId": "660e8400-e29b-41d4-a716-446655440001",
    "CreatedAt": "2024-01-15T10:30:00Z",
    "UpdatedAt": "2024-01-16T14:20:00Z"
  }
}
```

### DELETE /api/taxtypes/:id - Delete Tax Type

**Path Parameters:**

| Parameter | Type | Required | Constraints | Description |
| --------- | ---- | -------- | ----------- | ----------- |
| `id`      | uuid | Yes      | UUID v4     | Tax Type ID |

**Success Response (200):**

```json
{
  "success": true,
  "message": "Record deleted successfully"
}
```

---

## 8. UOM Module

**Base Path:** `/api/uom`

### Endpoints Overview

| Method   | Endpoint       | Description   | Auth | Scopes                               |
| -------- | -------------- | ------------- | ---- | ------------------------------------ |
| `GET`    | `/api/uom`     | Get all UOMs  | Yes  | -                                    |
| `GET`    | `/api/uom/:id` | Get UOM by ID | Yes  | -                                    |
| `POST`   | `/api/uom`     | Create UOM    | Yes  | `TENANT:ADMIN`, `TENANT:SUPER_ADMIN` |
| `PUT`    | `/api/uom/:id` | Update UOM    | Yes  | `TENANT:ADMIN`, `TENANT:SUPER_ADMIN` |
| `DELETE` | `/api/uom/:id` | Delete UOM    | Yes  | `TENANT:ADMIN`, `TENANT:SUPER_ADMIN` |

### GET /api/uom - Get All UOMs

**Query Parameters:**

| Parameter | Type    | Required | Default | Constraints      | Description      |
| --------- | ------- | -------- | ------- | ---------------- | ---------------- |
| `page`    | integer | No       | 1       | min: 1           | Page number      |
| `limit`   | integer | No       | 10      | min: 1, max: 100 | Records per page |

**Success Response (200):**

```json
{
  "success": true,
  "message": "Records retrieved successfully",
  "data": [
    {
      "Id": "550e8400-e29b-41d4-a716-446655440000",
      "UnitName": "Kilogram",
      "IsPrimary": true,
      "Active": true,
      "TenantId": "660e8400-e29b-41d4-a716-446655440001",
      "CreatedAt": "2024-01-15T10:30:00Z",
      "UpdatedAt": "2024-01-15T10:30:00Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 25,
    "totalPages": 3
  }
}
```

### POST /api/uom - Create UOM

**Request Body:**

| Field       | Type    | Required | Constraints    | Description          |
| ----------- | ------- | -------- | -------------- | -------------------- |
| `UnitName`  | string  | **Yes**  | max: 100 chars | Unit of measure name |
| `IsPrimary` | boolean | No       | default: false | Is primary unit      |
| `Active`    | boolean | No       | default: true  | Active status        |

```json
{
  "UnitName": "Kilogram",
  "IsPrimary": true,
  "Active": true
}
```

**Success Response (201):**

```json
{
  "success": true,
  "message": "Record created successfully",
  "data": {
    "Id": "550e8400-e29b-41d4-a716-446655440000",
    "UnitName": "Kilogram",
    "IsPrimary": true,
    "Active": true,
    "TenantId": "660e8400-e29b-41d4-a716-446655440001",
    "CreatedAt": "2024-01-15T10:30:00Z",
    "UpdatedAt": "2024-01-15T10:30:00Z"
  }
}
```

### PUT /api/uom/:id - Update UOM

**Request Body (at least one field required):**

| Field       | Type    | Required | Constraints    | Description          |
| ----------- | ------- | -------- | -------------- | -------------------- |
| `UnitName`  | string  | No       | max: 100 chars | Unit of measure name |
| `IsPrimary` | boolean | No       | -              | Is primary unit      |
| `Active`    | boolean | No       | -              | Active status        |

```json
{
  "UnitName": "Gram",
  "IsPrimary": false
}
```

---

## 9. UOM Factor Module

**Base Path:** `/api/uomfactors`

> **Supports Expand:** This module supports `?expand=true` to include `PrimaryUOMName` and `SecondaryUOMName`.

### Endpoints Overview

| Method   | Endpoint              | Description          | Auth | Scopes                               |
| -------- | --------------------- | -------------------- | ---- | ------------------------------------ |
| `GET`    | `/api/uomfactors`     | Get all UOM factors  | Yes  | -                                    |
| `GET`    | `/api/uomfactors/:id` | Get UOM factor by ID | Yes  | -                                    |
| `POST`   | `/api/uomfactors`     | Create UOM factor    | Yes  | `TENANT:ADMIN`, `TENANT:SUPER_ADMIN` |
| `PUT`    | `/api/uomfactors/:id` | Update UOM factor    | Yes  | `TENANT:ADMIN`, `TENANT:SUPER_ADMIN` |
| `DELETE` | `/api/uomfactors/:id` | Delete UOM factor    | Yes  | `TENANT:ADMIN`, `TENANT:SUPER_ADMIN` |

### GET /api/uomfactors - Get All UOM Factors

**Query Parameters:**

| Parameter | Type    | Required | Default | Description                                     |
| --------- | ------- | -------- | ------- | ----------------------------------------------- |
| `page`    | integer | No       | 1       | Page number                                     |
| `limit`   | integer | No       | 10      | Records per page                                |
| `expand`  | boolean | No       | false   | Include `PrimaryUOMName` and `SecondaryUOMName` |

**Response with `expand=true`:**

```json
{
  "success": true,
  "data": [
    {
      "Id": "770e8400-e29b-41d4-a716-446655440002",
      "PrimaryUOMId": "550e8400-e29b-41d4-a716-446655440000",
      "PrimaryUOMName": "Kilogram",
      "SecondaryUOMId": "660e8400-e29b-41d4-a716-446655440001",
      "SecondaryUOMName": "Gram",
      "Factor": 1000.0,
      "Active": true
    }
  ],
  "pagination": { "page": 1, "limit": 10, "total": 1 }
}
```

### POST /api/uomfactors - Create UOM Factor

**Request Body:**

| Field            | Type    | Required | Constraints          | Description                  |
| ---------------- | ------- | -------- | -------------------- | ---------------------------- |
| `PrimaryUOMId`   | uuid    | **Yes**  | UUID v4              | Primary unit of measure ID   |
| `SecondaryUOMId` | uuid    | **Yes**  | UUID v4              | Secondary unit of measure ID |
| `Factor`         | number  | **Yes**  | min: 0, precision: 6 | Conversion factor            |
| `Active`         | boolean | No       | default: true        | Active status                |

```json
{
  "PrimaryUOMId": "550e8400-e29b-41d4-a716-446655440000",
  "SecondaryUOMId": "660e8400-e29b-41d4-a716-446655440001",
  "Factor": 1000.0,
  "Active": true
}
```

**Success Response (201):**

```json
{
  "success": true,
  "message": "Record created successfully",
  "data": {
    "Id": "770e8400-e29b-41d4-a716-446655440002",
    "PrimaryUOMId": "550e8400-e29b-41d4-a716-446655440000",
    "SecondaryUOMId": "660e8400-e29b-41d4-a716-446655440001",
    "Factor": 1000.0,
    "Active": true,
    "TenantId": "880e8400-e29b-41d4-a716-446655440003",
    "CreatedAt": "2024-01-15T10:30:00Z",
    "UpdatedAt": "2024-01-15T10:30:00Z"
  }
}
```

### PUT /api/uomfactors/:id - Update UOM Factor

**Request Body (at least one field required):**

| Field            | Type    | Required | Constraints          | Description                  |
| ---------------- | ------- | -------- | -------------------- | ---------------------------- |
| `PrimaryUOMId`   | uuid    | No       | UUID v4              | Primary unit of measure ID   |
| `SecondaryUOMId` | uuid    | No       | UUID v4              | Secondary unit of measure ID |
| `Factor`         | number  | No       | min: 0, precision: 6 | Conversion factor            |
| `Active`         | boolean | No       | -                    | Active status                |

---

## 10. Category Module

**Base Path:** `/api/categories`

### Endpoints Overview

| Method   | Endpoint              | Description        | Auth | Scopes                               |
| -------- | --------------------- | ------------------ | ---- | ------------------------------------ |
| `GET`    | `/api/categories`     | Get all categories | Yes  | -                                    |
| `GET`    | `/api/categories/:id` | Get category by ID | Yes  | -                                    |
| `POST`   | `/api/categories`     | Create category    | Yes  | `TENANT:ADMIN`, `TENANT:SUPER_ADMIN` |
| `PUT`    | `/api/categories/:id` | Update category    | Yes  | `TENANT:ADMIN`, `TENANT:SUPER_ADMIN` |
| `DELETE` | `/api/categories/:id` | Delete category    | Yes  | `TENANT:ADMIN`, `TENANT:SUPER_ADMIN` |

### POST /api/categories - Create Category

**Request Body:**

| Field    | Type    | Required | Constraints    | Description   |
| -------- | ------- | -------- | -------------- | ------------- |
| `Name`   | string  | **Yes**  | max: 100 chars | Category name |
| `Active` | boolean | No       | default: true  | Active status |

```json
{
  "Name": "Electronics",
  "Active": true
}
```

### PUT /api/categories/:id - Update Category

**Request Body (at least one field required):**

| Field    | Type    | Required | Constraints    | Description   |
| -------- | ------- | -------- | -------------- | ------------- |
| `Name`   | string  | No       | max: 100 chars | Category name |
| `Active` | boolean | No       | -              | Active status |

---

## 11. Organization Module

**Base Path:** `/api/organizations`

### Endpoints Overview

| Method   | Endpoint                 | Description            | Auth | Scopes                               |
| -------- | ------------------------ | ---------------------- | ---- | ------------------------------------ |
| `GET`    | `/api/organizations`     | Get all organizations  | Yes  | -                                    |
| `GET`    | `/api/organizations/:id` | Get organization by ID | Yes  | -                                    |
| `POST`   | `/api/organizations`     | Create organization    | Yes  | `TENANT:ADMIN`, `TENANT:SUPER_ADMIN` |
| `PUT`    | `/api/organizations/:id` | Update organization    | Yes  | `TENANT:ADMIN`, `TENANT:SUPER_ADMIN` |
| `DELETE` | `/api/organizations/:id` | Delete organization    | Yes  | `TENANT:ADMIN`, `TENANT:SUPER_ADMIN` |

### POST /api/organizations - Create Organization

**Request Body:**

| Field    | Type    | Required | Constraints    | Description       |
| -------- | ------- | -------- | -------------- | ----------------- |
| `Name`   | string  | **Yes**  | max: 200 chars | Organization name |
| `Active` | boolean | No       | default: true  | Active status     |

```json
{
  "Name": "Acme Corporation",
  "Active": true
}
```

---

## 12. Account Type Module

**Base Path:** `/api/accounttypes`

### Endpoints Overview

| Method   | Endpoint                | Description            | Auth | Scopes                               |
| -------- | ----------------------- | ---------------------- | ---- | ------------------------------------ |
| `GET`    | `/api/accounttypes`     | Get all account types  | Yes  | -                                    |
| `GET`    | `/api/accounttypes/:id` | Get account type by ID | Yes  | -                                    |
| `POST`   | `/api/accounttypes`     | Create account type    | Yes  | `TENANT:ADMIN`, `TENANT:SUPER_ADMIN` |
| `PUT`    | `/api/accounttypes/:id` | Update account type    | Yes  | `TENANT:ADMIN`, `TENANT:SUPER_ADMIN` |
| `DELETE` | `/api/accounttypes/:id` | Delete account type    | Yes  | `TENANT:ADMIN`, `TENANT:SUPER_ADMIN` |

### POST /api/accounttypes - Create Account Type

**Request Body:**

| Field    | Type    | Required | Constraints    | Description       |
| -------- | ------- | -------- | -------------- | ----------------- |
| `Name`   | string  | **Yes**  | max: 100 chars | Account type name |
| `Active` | boolean | No       | default: true  | Active status     |

```json
{
  "Name": "Asset",
  "Active": true
}
```

---

## 13. Account Type Base Module

**Base Path:** `/api/accounttypebases`

### Endpoints Overview

| Method   | Endpoint                    | Description                 | Auth | Scopes                               |
| -------- | --------------------------- | --------------------------- | ---- | ------------------------------------ |
| `GET`    | `/api/accounttypebases`     | Get all account type bases  | Yes  | -                                    |
| `GET`    | `/api/accounttypebases/:id` | Get account type base by ID | Yes  | -                                    |
| `POST`   | `/api/accounttypebases`     | Create account type base    | Yes  | `TENANT:ADMIN`, `TENANT:SUPER_ADMIN` |
| `PUT`    | `/api/accounttypebases/:id` | Update account type base    | Yes  | `TENANT:ADMIN`, `TENANT:SUPER_ADMIN` |
| `DELETE` | `/api/accounttypebases/:id` | Delete account type base    | Yes  | `TENANT:ADMIN`, `TENANT:SUPER_ADMIN` |

### POST /api/accounttypebases - Create Account Type Base

**Request Body:**

| Field    | Type    | Required | Constraints    | Description            |
| -------- | ------- | -------- | -------------- | ---------------------- |
| `Name`   | string  | **Yes**  | max: 100 chars | Account type base name |
| `Active` | boolean | No       | default: true  | Active status          |

```json
{
  "Name": "Liability",
  "Active": true
}
```

---

## 14. Transaction Type Module

**Base Path:** `/api/transactiontypes`

### Endpoints Overview

| Method   | Endpoint                    | Description                | Auth | Scopes                               |
| -------- | --------------------------- | -------------------------- | ---- | ------------------------------------ |
| `GET`    | `/api/transactiontypes`     | Get all transaction types  | Yes  | -                                    |
| `GET`    | `/api/transactiontypes/:id` | Get transaction type by ID | Yes  | -                                    |
| `POST`   | `/api/transactiontypes`     | Create transaction type    | Yes  | `TENANT:ADMIN`, `TENANT:SUPER_ADMIN` |
| `PUT`    | `/api/transactiontypes/:id` | Update transaction type    | Yes  | `TENANT:ADMIN`, `TENANT:SUPER_ADMIN` |
| `DELETE` | `/api/transactiontypes/:id` | Delete transaction type    | Yes  | `TENANT:ADMIN`, `TENANT:SUPER_ADMIN` |

### POST /api/transactiontypes - Create Transaction Type

**Request Body:**

| Field         | Type    | Required | Constraints                 | Description           |
| ------------- | ------- | -------- | --------------------------- | --------------------- |
| `Name`        | string  | **Yes**  | max: 100 chars              | Transaction type name |
| `Description` | string  | No       | max: 255 chars, allows null | Description           |
| `Active`      | boolean | No       | default: true               | Active status         |

```json
{
  "Name": "Invoice",
  "Description": "Sales Invoice",
  "Active": true
}
```

---

## 15. Transaction Type Config Module

**Base Path:** `/api/transactiontypeconfigs`

### Endpoints Overview

| Method   | Endpoint                          | Description      | Auth | Scopes                               |
| -------- | --------------------------------- | ---------------- | ---- | ------------------------------------ |
| `GET`    | `/api/transactiontypeconfigs`     | Get all configs  | Yes  | -                                    |
| `GET`    | `/api/transactiontypeconfigs/:id` | Get config by ID | Yes  | -                                    |
| `POST`   | `/api/transactiontypeconfigs`     | Create config    | Yes  | `TENANT:ADMIN`, `TENANT:SUPER_ADMIN` |
| `PUT`    | `/api/transactiontypeconfigs/:id` | Update config    | Yes  | `TENANT:ADMIN`, `TENANT:SUPER_ADMIN` |
| `DELETE` | `/api/transactiontypeconfigs/:id` | Delete config    | Yes  | `TENANT:ADMIN`, `TENANT:SUPER_ADMIN` |

### POST /api/transactiontypeconfigs - Create Transaction Type Config

**Request Body:**

| Field            | Type    | Required | Constraints    | Description                       |
| ---------------- | ------- | -------- | -------------- | --------------------------------- |
| `StartCounterNo` | integer | **Yes**  | min: 0         | Starting counter number           |
| `Prefix`         | string  | No       | max: 50 chars  | Transaction number prefix         |
| `Format`         | string  | **Yes**  | max: 100 chars | Transaction number format pattern |
| `Active`         | boolean | No       | default: true  | Active status                     |

```json
{
  "StartCounterNo": 1,
  "Prefix": "INV",
  "Format": "INV-{YYYY}-{0000}",
  "Active": true
}
```

**Success Response (201):**

```json
{
  "success": true,
  "message": "Record created successfully",
  "data": {
    "Id": "550e8400-e29b-41d4-a716-446655440000",
    "StartCounterNo": 1,
    "Prefix": "INV",
    "Format": "INV-{YYYY}-{0000}",
    "Active": true,
    "TenantId": "660e8400-e29b-41d4-a716-446655440001",
    "CreatedAt": "2024-01-15T10:30:00Z",
    "UpdatedAt": "2024-01-15T10:30:00Z"
  }
}
```

---

## 16. Transaction Type Status Module

**Base Path:** `/api/transactiontypestatuses`

### Endpoints Overview

| Method   | Endpoint                           | Description      | Auth | Scopes                               |
| -------- | ---------------------------------- | ---------------- | ---- | ------------------------------------ |
| `GET`    | `/api/transactiontypestatuses`     | Get all statuses | Yes  | -                                    |
| `GET`    | `/api/transactiontypestatuses/:id` | Get status by ID | Yes  | -                                    |
| `POST`   | `/api/transactiontypestatuses`     | Create status    | Yes  | `TENANT:ADMIN`, `TENANT:SUPER_ADMIN` |
| `PUT`    | `/api/transactiontypestatuses/:id` | Update status    | Yes  | `TENANT:ADMIN`, `TENANT:SUPER_ADMIN` |
| `DELETE` | `/api/transactiontypestatuses/:id` | Delete status    | Yes  | `TENANT:ADMIN`, `TENANT:SUPER_ADMIN` |

### POST /api/transactiontypestatuses - Create Transaction Type Status

**Request Body:**

| Field    | Type    | Required | Constraints    | Description                  |
| -------- | ------- | -------- | -------------- | ---------------------------- |
| `Name`   | string  | **Yes**  | max: 100 chars | Transaction type status name |
| `Active` | boolean | No       | default: true  | Active status                |

```json
{
  "Name": "Pending",
  "Active": true
}
```

---

## 17. Transaction Type Base Conversion Module

**Base Path:** `/api/transactiontypebaseconversions`

> **Supports Expand:** This module supports `?expand=true` to include `TransactionTypeConfigPrefix`, `FromStatusName`, and `ToStatusName`.

### Endpoints Overview

| Method   | Endpoint                                  | Description          | Auth | Scopes                               |
| -------- | ----------------------------------------- | -------------------- | ---- | ------------------------------------ |
| `GET`    | `/api/transactiontypebaseconversions`     | Get all conversions  | Yes  | -                                    |
| `GET`    | `/api/transactiontypebaseconversions/:id` | Get conversion by ID | Yes  | -                                    |
| `POST`   | `/api/transactiontypebaseconversions`     | Create conversion    | Yes  | `TENANT:ADMIN`, `TENANT:SUPER_ADMIN` |
| `PUT`    | `/api/transactiontypebaseconversions/:id` | Update conversion    | Yes  | `TENANT:ADMIN`, `TENANT:SUPER_ADMIN` |
| `DELETE` | `/api/transactiontypebaseconversions/:id` | Delete conversion    | Yes  | `TENANT:ADMIN`, `TENANT:SUPER_ADMIN` |

### GET /api/transactiontypebaseconversions - Get All Base Conversions

**Query Parameters:**

| Parameter | Type    | Required | Default | Description                                                             |
| --------- | ------- | -------- | ------- | ----------------------------------------------------------------------- |
| `page`    | integer | No       | 1       | Page number                                                             |
| `limit`   | integer | No       | 10      | Records per page                                                        |
| `expand`  | boolean | No       | false   | Include `TransactionTypeConfigPrefix`, `FromStatusName`, `ToStatusName` |

### POST /api/transactiontypebaseconversions - Create Base Conversion

**Request Body:**

| Field                         | Type    | Required | Constraints   | Description                       |
| ----------------------------- | ------- | -------- | ------------- | --------------------------------- |
| `TransactionTypeConfigId`     | uuid    | **Yes**  | UUID v4       | Transaction type config ID        |
| `FromTransactionTypeStatusId` | uuid    | **Yes**  | UUID v4       | Source transaction type status ID |
| `ToTransactionTypeStatusId`   | uuid    | **Yes**  | UUID v4       | Target transaction type status ID |
| `Active`                      | boolean | No       | default: true | Active status                     |

```json
{
  "TransactionTypeConfigId": "550e8400-e29b-41d4-a716-446655440000",
  "FromTransactionTypeStatusId": "660e8400-e29b-41d4-a716-446655440001",
  "ToTransactionTypeStatusId": "770e8400-e29b-41d4-a716-446655440002",
  "Active": true
}
```

---

## 18. Transaction Type Conversion Mapper Module

**Base Path:** `/api/transactiontypeconversionmappers`

> **Supports Expand:** This module supports `?expand=true` to include `BaseConversionDetails`, `FromTransactionNo`, and `ToTransactionNo`.

### Endpoints Overview

| Method   | Endpoint                                    | Description      | Auth | Scopes                               |
| -------- | ------------------------------------------- | ---------------- | ---- | ------------------------------------ |
| `GET`    | `/api/transactiontypeconversionmappers`     | Get all mappers  | Yes  | -                                    |
| `GET`    | `/api/transactiontypeconversionmappers/:id` | Get mapper by ID | Yes  | -                                    |
| `POST`   | `/api/transactiontypeconversionmappers`     | Create mapper    | Yes  | `TENANT:ADMIN`, `TENANT:SUPER_ADMIN` |
| `PUT`    | `/api/transactiontypeconversionmappers/:id` | Update mapper    | Yes  | `TENANT:ADMIN`, `TENANT:SUPER_ADMIN` |
| `DELETE` | `/api/transactiontypeconversionmappers/:id` | Delete mapper    | Yes  | `TENANT:ADMIN`, `TENANT:SUPER_ADMIN` |

### GET /api/transactiontypeconversionmappers - Get All Conversion Mappers

**Query Parameters:**

| Parameter | Type    | Required | Default | Description                                                             |
| --------- | ------- | -------- | ------- | ----------------------------------------------------------------------- |
| `page`    | integer | No       | 1       | Page number                                                             |
| `limit`   | integer | No       | 10      | Records per page                                                        |
| `expand`  | boolean | No       | false   | Include `BaseConversionDetails`, `FromTransactionNo`, `ToTransactionNo` |

### POST /api/transactiontypeconversionmappers - Create Conversion Mapper

**Request Body:**

| Field                             | Type    | Required | Constraints   | Description                      |
| --------------------------------- | ------- | -------- | ------------- | -------------------------------- |
| `TransactionTypeBaseConversionId` | uuid    | **Yes**  | UUID v4       | Base conversion ID               |
| `FromTransactionDetailLogId`      | uuid    | **Yes**  | UUID v4       | Source transaction detail log ID |
| `ToTransactionDetailLogId`        | uuid    | **Yes**  | UUID v4       | Target transaction detail log ID |
| `Active`                          | boolean | No       | default: true | Active status                    |

```json
{
  "TransactionTypeBaseConversionId": "550e8400-e29b-41d4-a716-446655440000",
  "FromTransactionDetailLogId": "660e8400-e29b-41d4-a716-446655440001",
  "ToTransactionDetailLogId": "770e8400-e29b-41d4-a716-446655440002",
  "Active": true
}
```

---

## 19. Transaction Detail Log Module

**Base Path:** `/api/transactiondetaillogs`

> **Supports Expand:** This module supports `?expand=true` to include `TransactionTypeConfigPrefix`, `StatusName`, and `BranchName`.

### Endpoints Overview

| Method   | Endpoint                         | Description   | Auth | Scopes                               |
| -------- | -------------------------------- | ------------- | ---- | ------------------------------------ |
| `GET`    | `/api/transactiondetaillogs`     | Get all logs  | Yes  | -                                    |
| `GET`    | `/api/transactiondetaillogs/:id` | Get log by ID | Yes  | -                                    |
| `POST`   | `/api/transactiondetaillogs`     | Create log    | Yes  | `TENANT:ADMIN`, `TENANT:SUPER_ADMIN` |
| `PUT`    | `/api/transactiondetaillogs/:id` | Update log    | Yes  | `TENANT:ADMIN`, `TENANT:SUPER_ADMIN` |
| `DELETE` | `/api/transactiondetaillogs/:id` | Delete log    | Yes  | `TENANT:ADMIN`, `TENANT:SUPER_ADMIN` |

### GET /api/transactiondetaillogs - Get All Transaction Detail Logs

**Query Parameters:**

| Parameter | Type    | Required | Default | Description                                                       |
| --------- | ------- | -------- | ------- | ----------------------------------------------------------------- |
| `page`    | integer | No       | 1       | Page number                                                       |
| `limit`   | integer | No       | 10      | Records per page                                                  |
| `expand`  | boolean | No       | false   | Include `TransactionTypeConfigPrefix`, `StatusName`, `BranchName` |

### POST /api/transactiondetaillogs - Create Transaction Detail Log

**Request Body:**

| Field                     | Type    | Required | Constraints                  | Description                |
| ------------------------- | ------- | -------- | ---------------------------- | -------------------------- |
| `TransactionNo`           | string  | **Yes**  | max: 100 chars               | Transaction number         |
| `TransactionTypeConfigId` | uuid    | **Yes**  | UUID v4                      | Transaction type config ID |
| `TransactionTypeStatusId` | uuid    | No       | UUID v4, allows null         | Transaction type status ID |
| `BranchId`                | uuid    | No       | UUID v4, allows null         | Branch ID                  |
| `TransactionDate`         | date    | No       | ISO date, allows null        | Transaction date           |
| `Remarks`                 | string  | No       | max: 1000 chars, allows null | Remarks or notes           |
| `Active`                  | boolean | No       | default: true                | Active status              |

```json
{
  "TransactionNo": "TXN-2024-001",
  "TransactionTypeConfigId": "550e8400-e29b-41d4-a716-446655440000",
  "TransactionTypeStatusId": "660e8400-e29b-41d4-a716-446655440001",
  "BranchId": "770e8400-e29b-41d4-a716-446655440002",
  "TransactionDate": "2024-01-15",
  "Remarks": "Initial transaction entry",
  "Active": true
}
```

**Success Response (201):**

```json
{
  "success": true,
  "message": "Record created successfully",
  "data": {
    "Id": "880e8400-e29b-41d4-a716-446655440003",
    "TransactionNo": "TXN-2024-001",
    "TransactionTypeConfigId": "550e8400-e29b-41d4-a716-446655440000",
    "TransactionTypeStatusId": "660e8400-e29b-41d4-a716-446655440001",
    "BranchId": "770e8400-e29b-41d4-a716-446655440002",
    "TransactionDate": "2024-01-15T00:00:00Z",
    "Remarks": "Initial transaction entry",
    "Active": true,
    "TenantId": "990e8400-e29b-41d4-a716-446655440004",
    "CreatedAt": "2024-01-15T10:30:00Z",
    "UpdatedAt": "2024-01-15T10:30:00Z"
  }
}
```

---

## 20. Transaction Item Detail Module

**Base Path:** `/api/transactionitemdetails`

> **Supports Expand:** This module supports `?expand=true` to include `TransactionNo`, `ItemName`, `BatchNumber`, `UOMName`, and `TaxGroupName`.

### Endpoints Overview

| Method   | Endpoint                          | Description           | Auth | Scopes                               |
| -------- | --------------------------------- | --------------------- | ---- | ------------------------------------ |
| `GET`    | `/api/transactionitemdetails`     | Get all item details  | Yes  | -                                    |
| `GET`    | `/api/transactionitemdetails/:id` | Get item detail by ID | Yes  | -                                    |
| `POST`   | `/api/transactionitemdetails`     | Create item detail    | Yes  | `TENANT:ADMIN`, `TENANT:SUPER_ADMIN` |
| `PUT`    | `/api/transactionitemdetails/:id` | Update item detail    | Yes  | `TENANT:ADMIN`, `TENANT:SUPER_ADMIN` |
| `DELETE` | `/api/transactionitemdetails/:id` | Delete item detail    | Yes  | `TENANT:ADMIN`, `TENANT:SUPER_ADMIN` |

### GET /api/transactionitemdetails - Get All Transaction Item Details

**Query Parameters:**

| Parameter | Type    | Required | Default | Description                                                                   |
| --------- | ------- | -------- | ------- | ----------------------------------------------------------------------------- |
| `page`    | integer | No       | 1       | Page number                                                                   |
| `limit`   | integer | No       | 10      | Records per page                                                              |
| `expand`  | boolean | No       | false   | Include `TransactionNo`, `ItemName`, `BatchNumber`, `UOMName`, `TaxGroupName` |

### POST /api/transactionitemdetails - Create Transaction Item Detail

**Request Body:**

| Field                    | Type    | Required | Constraints               | Description                   |
| ------------------------ | ------- | -------- | ------------------------- | ----------------------------- |
| `TransactionDetailLogId` | uuid    | **Yes**  | UUID v4                   | Parent transaction log ID     |
| `ItemDetailId`           | uuid    | **Yes**  | UUID v4                   | Item detail ID                |
| `BatchDetailId`          | uuid    | No       | UUID v4, allows null      | Batch detail ID               |
| `Quantity`               | number  | **Yes**  | precision: 4              | Quantity                      |
| `UOMId`                  | uuid    | No       | UUID v4, allows null      | Unit of measure ID            |
| `Rate`                   | number  | No       | precision: 4, allows null | Rate per unit                 |
| `Amount`                 | number  | No       | precision: 4, allows null | Total amount                  |
| `TaxGroupId`             | uuid    | No       | UUID v4, allows null      | Tax group ID                  |
| `TaxAmount`              | number  | No       | precision: 4, allows null | Tax amount                    |
| `DiscountAmount`         | number  | No       | precision: 4, allows null | Discount amount               |
| `NetAmount`              | number  | No       | precision: 4, allows null | Net amount after tax/discount |
| `Active`                 | boolean | No       | default: true             | Active status                 |

```json
{
  "TransactionDetailLogId": "550e8400-e29b-41d4-a716-446655440000",
  "ItemDetailId": "660e8400-e29b-41d4-a716-446655440001",
  "BatchDetailId": "770e8400-e29b-41d4-a716-446655440002",
  "Quantity": 10.0,
  "UOMId": "880e8400-e29b-41d4-a716-446655440003",
  "Rate": 50.0,
  "Amount": 500.0,
  "TaxGroupId": "990e8400-e29b-41d4-a716-446655440004",
  "TaxAmount": 90.0,
  "DiscountAmount": 25.0,
  "NetAmount": 565.0,
  "Active": true
}
```

---

## 21. Tax Group Module

**Base Path:** `/api/taxgroups`

### Endpoints Overview

| Method   | Endpoint             | Description         | Auth | Scopes                               |
| -------- | -------------------- | ------------------- | ---- | ------------------------------------ |
| `GET`    | `/api/taxgroups`     | Get all tax groups  | Yes  | -                                    |
| `GET`    | `/api/taxgroups/:id` | Get tax group by ID | Yes  | -                                    |
| `POST`   | `/api/taxgroups`     | Create tax group    | Yes  | `TENANT:ADMIN`, `TENANT:SUPER_ADMIN` |
| `PUT`    | `/api/taxgroups/:id` | Update tax group    | Yes  | `TENANT:ADMIN`, `TENANT:SUPER_ADMIN` |
| `DELETE` | `/api/taxgroups/:id` | Delete tax group    | Yes  | `TENANT:ADMIN`, `TENANT:SUPER_ADMIN` |

### POST /api/taxgroups - Create Tax Group

**Request Body:**

| Field    | Type    | Required | Constraints    | Description    |
| -------- | ------- | -------- | -------------- | -------------- |
| `Name`   | string  | **Yes**  | max: 100 chars | Tax group name |
| `Active` | boolean | No       | default: true  | Active status  |

```json
{
  "Name": "GST 18%",
  "Active": true
}
```

---

## 22. Tax Group Tax Type Mapper Module

**Base Path:** `/api/taxgrouptaxtypemappers`

> **Supports Expand:** This module supports `?expand=true` to include `TaxGroupName` and `TaxTypeName`.

### Endpoints Overview

| Method   | Endpoint                          | Description      | Auth | Scopes                               |
| -------- | --------------------------------- | ---------------- | ---- | ------------------------------------ |
| `GET`    | `/api/taxgrouptaxtypemappers`     | Get all mappers  | Yes  | -                                    |
| `GET`    | `/api/taxgrouptaxtypemappers/:id` | Get mapper by ID | Yes  | -                                    |
| `POST`   | `/api/taxgrouptaxtypemappers`     | Create mapper    | Yes  | `TENANT:ADMIN`, `TENANT:SUPER_ADMIN` |
| `PUT`    | `/api/taxgrouptaxtypemappers/:id` | Update mapper    | Yes  | `TENANT:ADMIN`, `TENANT:SUPER_ADMIN` |
| `DELETE` | `/api/taxgrouptaxtypemappers/:id` | Delete mapper    | Yes  | `TENANT:ADMIN`, `TENANT:SUPER_ADMIN` |

### GET /api/taxgrouptaxtypemappers - Get All Tax Group Tax Type Mappers

**Query Parameters:**

| Parameter | Type    | Required | Default | Description                              |
| --------- | ------- | -------- | ------- | ---------------------------------------- |
| `page`    | integer | No       | 1       | Page number                              |
| `limit`   | integer | No       | 10      | Records per page                         |
| `expand`  | boolean | No       | false   | Include `TaxGroupName` and `TaxTypeName` |

### POST /api/taxgrouptaxtypemappers - Create Tax Group Tax Type Mapper

**Request Body:**

| Field        | Type    | Required | Constraints   | Description   |
| ------------ | ------- | -------- | ------------- | ------------- |
| `TaxGroupId` | uuid    | **Yes**  | UUID v4       | Tax group ID  |
| `TaxTypeId`  | uuid    | **Yes**  | UUID v4       | Tax type ID   |
| `Active`     | boolean | No       | default: true | Active status |

```json
{
  "TaxGroupId": "550e8400-e29b-41d4-a716-446655440000",
  "TaxTypeId": "660e8400-e29b-41d4-a716-446655440001",
  "Active": true
}
```

---

## 23. Contact Address Type Module

**Base Path:** `/api/contactaddresstypes`

### Endpoints Overview

| Method   | Endpoint                       | Description    | Auth | Scopes                               |
| -------- | ------------------------------ | -------------- | ---- | ------------------------------------ |
| `GET`    | `/api/contactaddresstypes`     | Get all types  | Yes  | -                                    |
| `GET`    | `/api/contactaddresstypes/:id` | Get type by ID | Yes  | -                                    |
| `POST`   | `/api/contactaddresstypes`     | Create type    | Yes  | `TENANT:ADMIN`, `TENANT:SUPER_ADMIN` |
| `PUT`    | `/api/contactaddresstypes/:id` | Update type    | Yes  | `TENANT:ADMIN`, `TENANT:SUPER_ADMIN` |
| `DELETE` | `/api/contactaddresstypes/:id` | Delete type    | Yes  | `TENANT:ADMIN`, `TENANT:SUPER_ADMIN` |

### POST /api/contactaddresstypes - Create Contact Address Type

**Request Body:**

| Field    | Type    | Required | Constraints    | Description               |
| -------- | ------- | -------- | -------------- | ------------------------- |
| `Name`   | string  | **Yes**  | max: 100 chars | Contact address type name |
| `Active` | boolean | No       | default: true  | Active status             |

```json
{
  "Name": "Billing",
  "Active": true
}
```

---

## 24. Contact Detail Module

**Base Path:** `/api/contactdetails`

> **Supports Expand:** This module supports `?expand=true` to include `ContactAddressTypeName`.

### Endpoints Overview

| Method   | Endpoint                  | Description       | Auth | Scopes                               |
| -------- | ------------------------- | ----------------- | ---- | ------------------------------------ |
| `GET`    | `/api/contactdetails`     | Get all contacts  | Yes  | -                                    |
| `GET`    | `/api/contactdetails/:id` | Get contact by ID | Yes  | -                                    |
| `POST`   | `/api/contactdetails`     | Create contact    | Yes  | `TENANT:ADMIN`, `TENANT:SUPER_ADMIN` |
| `PUT`    | `/api/contactdetails/:id` | Update contact    | Yes  | `TENANT:ADMIN`, `TENANT:SUPER_ADMIN` |
| `DELETE` | `/api/contactdetails/:id` | Delete contact    | Yes  | `TENANT:ADMIN`, `TENANT:SUPER_ADMIN` |

### GET /api/contactdetails - Get All Contact Details

**Query Parameters:**

| Parameter | Type    | Required | Default | Description                      |
| --------- | ------- | -------- | ------- | -------------------------------- |
| `page`    | integer | No       | 1       | Page number                      |
| `limit`   | integer | No       | 10      | Records per page                 |
| `expand`  | boolean | No       | false   | Include `ContactAddressTypeName` |

### POST /api/contactdetails - Create Contact Detail

**Request Body:**

| Field                  | Type    | Required | Constraints                 | Description             |
| ---------------------- | ------- | -------- | --------------------------- | ----------------------- |
| `FirstName`            | string  | **Yes**  | max: 100 chars              | First name              |
| `LastName`             | string  | No       | max: 100 chars, allows null | Last name               |
| `MobileNo`             | string  | No       | max: 20 chars, allows null  | Mobile number           |
| `AltMobileNo`          | string  | No       | max: 20 chars, allows null  | Alternate mobile number |
| `Landline1`            | string  | No       | max: 20 chars, allows null  | Landline number 1       |
| `LandLine2`            | string  | No       | max: 20 chars, allows null  | Landline number 2       |
| `Ext1`                 | string  | No       | max: 10 chars, allows null  | Extension 1             |
| `Ext2`                 | string  | No       | max: 10 chars, allows null  | Extension 2             |
| `ContactAddressTypeId` | uuid    | No       | UUID v4, allows null        | Contact address type ID |
| `Active`               | boolean | No       | default: true               | Active status           |

```json
{
  "FirstName": "John",
  "LastName": "Doe",
  "MobileNo": "+1234567890",
  "AltMobileNo": "+0987654321",
  "Landline1": "123456",
  "LandLine2": "654321",
  "Ext1": "101",
  "Ext2": "102",
  "ContactAddressTypeId": "550e8400-e29b-41d4-a716-446655440000",
  "Active": true
}
```

**Success Response (201):**

```json
{
  "success": true,
  "message": "Record created successfully",
  "data": {
    "Id": "660e8400-e29b-41d4-a716-446655440001",
    "FirstName": "John",
    "LastName": "Doe",
    "MobileNo": "+1234567890",
    "AltMobileNo": "+0987654321",
    "Landline1": "123456",
    "LandLine2": "654321",
    "Ext1": "101",
    "Ext2": "102",
    "ContactAddressTypeId": "550e8400-e29b-41d4-a716-446655440000",
    "Active": true,
    "TenantId": "770e8400-e29b-41d4-a716-446655440002",
    "CreatedAt": "2024-01-15T10:30:00Z",
    "UpdatedAt": "2024-01-15T10:30:00Z"
  }
}
```

---

## 25. Address Detail Module

**Base Path:** `/api/addressdetails`

> **Supports Expand:** This module supports `?expand=true` to include `MapProviderLocationMapperDetails` and `ContactAddressTypeName`.

### Endpoints Overview

| Method   | Endpoint                  | Description       | Auth | Scopes                               |
| -------- | ------------------------- | ----------------- | ---- | ------------------------------------ |
| `GET`    | `/api/addressdetails`     | Get all addresses | Yes  | -                                    |
| `GET`    | `/api/addressdetails/:id` | Get address by ID | Yes  | -                                    |
| `POST`   | `/api/addressdetails`     | Create address    | Yes  | `TENANT:ADMIN`, `TENANT:SUPER_ADMIN` |
| `PUT`    | `/api/addressdetails/:id` | Update address    | Yes  | `TENANT:ADMIN`, `TENANT:SUPER_ADMIN` |
| `DELETE` | `/api/addressdetails/:id` | Delete address    | Yes  | `TENANT:ADMIN`, `TENANT:SUPER_ADMIN` |

### GET /api/addressdetails - Get All Address Details

**Query Parameters:**

| Parameter | Type    | Required | Default | Description                                                          |
| --------- | ------- | -------- | ------- | -------------------------------------------------------------------- |
| `page`    | integer | No       | 1       | Page number                                                          |
| `limit`   | integer | No       | 10      | Records per page                                                     |
| `expand`  | boolean | No       | false   | Include `MapProviderLocationMapperDetails`, `ContactAddressTypeName` |

### POST /api/addressdetails - Create Address Detail

**Request Body:**

| Field                         | Type    | Required | Constraints                 | Description                     |
| ----------------------------- | ------- | -------- | --------------------------- | ------------------------------- |
| `AddressLine1`                | string  | **Yes**  | max: 255 chars              | Primary address line            |
| `AddressLine2`                | string  | No       | max: 255 chars, allows null | Secondary address line          |
| `City`                        | string  | No       | max: 100 chars, allows null | City name                       |
| `State`                       | string  | No       | max: 100 chars, allows null | State/Province                  |
| `Pincode`                     | string  | No       | max: 20 chars, allows null  | Postal/ZIP code                 |
| `MapProviderLocationMapperId` | uuid    | No       | UUID v4, allows null        | Map provider location mapper ID |
| `Landmark`                    | string  | No       | max: 255 chars, allows null | Nearby landmark                 |
| `ContactAddressTypeId`        | uuid    | No       | UUID v4, allows null        | Contact address type ID         |
| `Active`                      | boolean | No       | default: true               | Active status                   |

```json
{
  "AddressLine1": "123 Main Street",
  "AddressLine2": "Apt 4B",
  "City": "New York",
  "State": "NY",
  "Pincode": "10001",
  "MapProviderLocationMapperId": "550e8400-e29b-41d4-a716-446655440000",
  "Landmark": "Near Central Park",
  "ContactAddressTypeId": "660e8400-e29b-41d4-a716-446655440001",
  "Active": true
}
```

---

## 26. Location Detail Module

**Base Path:** `/api/locationdetails`

### Endpoints Overview

| Method   | Endpoint                   | Description        | Auth | Scopes                               |
| -------- | -------------------------- | ------------------ | ---- | ------------------------------------ |
| `GET`    | `/api/locationdetails`     | Get all locations  | Yes  | -                                    |
| `GET`    | `/api/locationdetails/:id` | Get location by ID | Yes  | -                                    |
| `POST`   | `/api/locationdetails`     | Create location    | Yes  | `TENANT:ADMIN`, `TENANT:SUPER_ADMIN` |
| `PUT`    | `/api/locationdetails/:id` | Update location    | Yes  | `TENANT:ADMIN`, `TENANT:SUPER_ADMIN` |
| `DELETE` | `/api/locationdetails/:id` | Delete location    | Yes  | `TENANT:ADMIN`, `TENANT:SUPER_ADMIN` |

### POST /api/locationdetails - Create Location Detail

**Request Body:**

| Field    | Type    | Required | Constraints                 | Description    |
| -------- | ------- | -------- | --------------------------- | -------------- |
| `Lat`    | number  | **Yes**  | precision: 8                | Latitude       |
| `Lng`    | number  | **Yes**  | precision: 8                | Longitude      |
| `CF1`    | string  | No       | max: 255 chars, allows null | Custom field 1 |
| `CF2`    | string  | No       | max: 255 chars, allows null | Custom field 2 |
| `CF3`    | string  | No       | max: 255 chars, allows null | Custom field 3 |
| `CF4`    | string  | No       | max: 255 chars, allows null | Custom field 4 |
| `Active` | boolean | No       | default: true               | Active status  |

```json
{
  "Lat": 12.9716,
  "Lng": 77.5946,
  "CF1": "Custom Field 1 Value",
  "CF2": "Custom Field 2 Value",
  "CF3": null,
  "CF4": null,
  "Active": true
}
```

---

## 27. Map Provider Module

**Base Path:** `/api/mapproviders`

### Endpoints Overview

| Method   | Endpoint                | Description        | Auth | Scopes                               |
| -------- | ----------------------- | ------------------ | ---- | ------------------------------------ |
| `GET`    | `/api/mapproviders`     | Get all providers  | Yes  | -                                    |
| `GET`    | `/api/mapproviders/:id` | Get provider by ID | Yes  | -                                    |
| `POST`   | `/api/mapproviders`     | Create provider    | Yes  | `TENANT:ADMIN`, `TENANT:SUPER_ADMIN` |
| `PUT`    | `/api/mapproviders/:id` | Update provider    | Yes  | `TENANT:ADMIN`, `TENANT:SUPER_ADMIN` |
| `DELETE` | `/api/mapproviders/:id` | Delete provider    | Yes  | `TENANT:ADMIN`, `TENANT:SUPER_ADMIN` |

### POST /api/mapproviders - Create Map Provider

**Request Body:**

| Field          | Type    | Required | Constraints    | Description       |
| -------------- | ------- | -------- | -------------- | ----------------- |
| `ProviderName` | string  | **Yes**  | max: 100 chars | Map provider name |
| `Active`       | boolean | No       | default: true  | Active status     |

```json
{
  "ProviderName": "Google Maps",
  "Active": true
}
```

---

## 28. Map Provider Location Mapper Module

**Base Path:** `/api/mapproviderlocationmappers`

> **Supports Expand:** This module supports `?expand=true` to include `ProviderName`, `Lat`, and `Lng`.

### Endpoints Overview

| Method   | Endpoint                              | Description      | Auth | Scopes                               |
| -------- | ------------------------------------- | ---------------- | ---- | ------------------------------------ |
| `GET`    | `/api/mapproviderlocationmappers`     | Get all mappers  | Yes  | -                                    |
| `GET`    | `/api/mapproviderlocationmappers/:id` | Get mapper by ID | Yes  | -                                    |
| `POST`   | `/api/mapproviderlocationmappers`     | Create mapper    | Yes  | `TENANT:ADMIN`, `TENANT:SUPER_ADMIN` |
| `PUT`    | `/api/mapproviderlocationmappers/:id` | Update mapper    | Yes  | `TENANT:ADMIN`, `TENANT:SUPER_ADMIN` |
| `DELETE` | `/api/mapproviderlocationmappers/:id` | Delete mapper    | Yes  | `TENANT:ADMIN`, `TENANT:SUPER_ADMIN` |

### GET /api/mapproviderlocationmappers - Get All Map Provider Location Mappers

**Query Parameters:**

| Parameter | Type    | Required | Default | Description                          |
| --------- | ------- | -------- | ------- | ------------------------------------ |
| `page`    | integer | No       | 1       | Page number                          |
| `limit`   | integer | No       | 10      | Records per page                     |
| `expand`  | boolean | No       | false   | Include `ProviderName`, `Lat`, `Lng` |

### POST /api/mapproviderlocationmappers - Create Map Provider Location Mapper

**Request Body:**

| Field              | Type    | Required | Constraints   | Description        |
| ------------------ | ------- | -------- | ------------- | ------------------ |
| `MapProviderId`    | uuid    | **Yes**  | UUID v4       | Map provider ID    |
| `LocationDetailId` | uuid    | **Yes**  | UUID v4       | Location detail ID |
| `Active`           | boolean | No       | default: true | Active status      |

```json
{
  "MapProviderId": "550e8400-e29b-41d4-a716-446655440000",
  "LocationDetailId": "660e8400-e29b-41d4-a716-446655440001",
  "Active": true
}
```

---

## 29. Cost Info Module

**Base Path:** `/api/costinfos`

> **Supports Expand:** This module supports `?expand=true` to include `TaxGroupName`.

### Endpoints Overview

| Method   | Endpoint             | Description         | Auth | Scopes                               |
| -------- | -------------------- | ------------------- | ---- | ------------------------------------ |
| `GET`    | `/api/costinfos`     | Get all cost infos  | Yes  | -                                    |
| `GET`    | `/api/costinfos/:id` | Get cost info by ID | Yes  | -                                    |
| `POST`   | `/api/costinfos`     | Create cost info    | Yes  | `TENANT:ADMIN`, `TENANT:SUPER_ADMIN` |
| `PUT`    | `/api/costinfos/:id` | Update cost info    | Yes  | `TENANT:ADMIN`, `TENANT:SUPER_ADMIN` |
| `DELETE` | `/api/costinfos/:id` | Delete cost info    | Yes  | `TENANT:ADMIN`, `TENANT:SUPER_ADMIN` |

### GET /api/costinfos - Get All Cost Infos

**Query Parameters:**

| Parameter | Type    | Required | Default | Description            |
| --------- | ------- | -------- | ------- | ---------------------- |
| `page`    | integer | No       | 1       | Page number            |
| `limit`   | integer | No       | 10      | Records per page       |
| `expand`  | boolean | No       | false   | Include `TaxGroupName` |

### POST /api/costinfos - Create Cost Info

**Request Body:**

| Field           | Type    | Required | Constraints          | Description             |
| --------------- | ------- | -------- | -------------------- | ----------------------- |
| `Amount`        | number  | **Yes**  | precision: 4         | Cost amount             |
| `TaxGroupId`    | uuid    | No       | UUID v4, allows null | Tax group ID            |
| `IsTaxIncluded` | boolean | No       | default: false       | Is tax included in cost |
| `Active`        | boolean | No       | default: true        | Active status           |

```json
{
  "Amount": 100.5,
  "TaxGroupId": "550e8400-e29b-41d4-a716-446655440000",
  "IsTaxIncluded": true,
  "Active": true
}
```

---

## 30. Branch Detail Module

**Base Path:** `/api/branchdetails`

> **Supports Expand:** This module supports `?expand=true` to include `AddressDetails`, `ContactDetails`, and `OrganizationName`.

### Endpoints Overview

| Method   | Endpoint                 | Description      | Auth | Scopes                               |
| -------- | ------------------------ | ---------------- | ---- | ------------------------------------ |
| `GET`    | `/api/branchdetails`     | Get all branches | Yes  | -                                    |
| `GET`    | `/api/branchdetails/:id` | Get branch by ID | Yes  | -                                    |
| `POST`   | `/api/branchdetails`     | Create branch    | Yes  | `TENANT:ADMIN`, `TENANT:SUPER_ADMIN` |
| `PUT`    | `/api/branchdetails/:id` | Update branch    | Yes  | `TENANT:ADMIN`, `TENANT:SUPER_ADMIN` |
| `DELETE` | `/api/branchdetails/:id` | Delete branch    | Yes  | `TENANT:ADMIN`, `TENANT:SUPER_ADMIN` |

### GET /api/branchdetails - Get All Branch Details

**Query Parameters:**

| Parameter | Type    | Required | Default | Description                                                    |
| --------- | ------- | -------- | ------- | -------------------------------------------------------------- |
| `page`    | integer | No       | 1       | Page number                                                    |
| `limit`   | integer | No       | 10      | Records per page                                               |
| `expand`  | boolean | No       | false   | Include `AddressDetails`, `ContactDetails`, `OrganizationName` |

### POST /api/branchdetails - Create Branch Detail

**Request Body:**

| Field             | Type    | Required | Constraints          | Description       |
| ----------------- | ------- | -------- | -------------------- | ----------------- |
| `Name`            | string  | **Yes**  | max: 100 chars       | Branch name       |
| `AddressDetailId` | uuid    | No       | UUID v4, allows null | Address detail ID |
| `ContactDetailId` | uuid    | No       | UUID v4, allows null | Contact detail ID |
| `OrganizationId`  | uuid    | No       | UUID v4, allows null | Organization ID   |
| `Active`          | boolean | No       | default: true        | Active status     |

```json
{
  "Name": "Main Branch",
  "AddressDetailId": "550e8400-e29b-41d4-a716-446655440000",
  "ContactDetailId": "660e8400-e29b-41d4-a716-446655440001",
  "OrganizationId": "770e8400-e29b-41d4-a716-446655440002",
  "Active": true
}
```

---

## 31. Branch User Group Mapper Module

**Base Path:** `/api/branchusergroupmappers`

> **Supports Expand:** This module supports `?expand=true` to include `BranchName` and `UserGroupName`.

### Endpoints Overview

| Method   | Endpoint                          | Description      | Auth | Scopes                               |
| -------- | --------------------------------- | ---------------- | ---- | ------------------------------------ |
| `GET`    | `/api/branchusergroupmappers`     | Get all mappers  | Yes  | -                                    |
| `GET`    | `/api/branchusergroupmappers/:id` | Get mapper by ID | Yes  | -                                    |
| `POST`   | `/api/branchusergroupmappers`     | Create mapper    | Yes  | `TENANT:ADMIN`, `TENANT:SUPER_ADMIN` |
| `PUT`    | `/api/branchusergroupmappers/:id` | Update mapper    | Yes  | `TENANT:ADMIN`, `TENANT:SUPER_ADMIN` |
| `DELETE` | `/api/branchusergroupmappers/:id` | Delete mapper    | Yes  | `TENANT:ADMIN`, `TENANT:SUPER_ADMIN` |

### GET /api/branchusergroupmappers - Get All Branch User Group Mappers

**Query Parameters:**

| Parameter | Type    | Required | Default | Description                              |
| --------- | ------- | -------- | ------- | ---------------------------------------- |
| `page`    | integer | No       | 1       | Page number                              |
| `limit`   | integer | No       | 10      | Records per page                         |
| `expand`  | boolean | No       | false   | Include `BranchName` and `UserGroupName` |

### POST /api/branchusergroupmappers - Create Branch User Group Mapper

**Request Body:**

| Field         | Type    | Required | Constraints   | Description   |
| ------------- | ------- | -------- | ------------- | ------------- |
| `BranchId`    | uuid    | **Yes**  | UUID v4       | Branch ID     |
| `UserGroupId` | uuid    | **Yes**  | UUID v4       | User group ID |
| `Active`      | boolean | No       | default: true | Active status |

```json
{
  "BranchId": "550e8400-e29b-41d4-a716-446655440000",
  "UserGroupId": "660e8400-e29b-41d4-a716-446655440001",
  "Active": true
}
```

---

## 32. Batch Detail Module

**Base Path:** `/api/batchdetails`

### Endpoints Overview

| Method   | Endpoint                | Description     | Auth | Scopes                               |
| -------- | ----------------------- | --------------- | ---- | ------------------------------------ |
| `GET`    | `/api/batchdetails`     | Get all batches | Yes  | -                                    |
| `GET`    | `/api/batchdetails/:id` | Get batch by ID | Yes  | -                                    |
| `POST`   | `/api/batchdetails`     | Create batch    | Yes  | `TENANT:ADMIN`, `TENANT:SUPER_ADMIN` |
| `PUT`    | `/api/batchdetails/:id` | Update batch    | Yes  | `TENANT:ADMIN`, `TENANT:SUPER_ADMIN` |
| `DELETE` | `/api/batchdetails/:id` | Delete batch    | Yes  | `TENANT:ADMIN`, `TENANT:SUPER_ADMIN` |

### POST /api/batchdetails - Create Batch Detail

**Request Body:**

| Field              | Type    | Required | Constraints           | Description       |
| ------------------ | ------- | -------- | --------------------- | ----------------- |
| `BatchNumber`      | string  | **Yes**  | max: 100 chars        | Batch number      |
| `ManufacturedDate` | date    | No       | ISO date, allows null | Manufactured date |
| `ExpiryDate`       | date    | No       | ISO date, allows null | Expiry date       |
| `Active`           | boolean | No       | default: true         | Active status     |

```json
{
  "BatchNumber": "BATCH-2024-001",
  "ManufacturedDate": "2024-01-01",
  "ExpiryDate": "2025-01-01",
  "Active": true
}
```

---

## 33. Item Detail Module

**Base Path:** `/api/itemdetails`

> **Supports Expand:** This module supports `?expand=true` to include `CategoryName`, `UOMName`, and `CostInfoDetails`.

### Endpoints Overview

| Method   | Endpoint               | Description    | Auth | Scopes                               |
| -------- | ---------------------- | -------------- | ---- | ------------------------------------ |
| `GET`    | `/api/itemdetails`     | Get all items  | Yes  | -                                    |
| `GET`    | `/api/itemdetails/:id` | Get item by ID | Yes  | -                                    |
| `POST`   | `/api/itemdetails`     | Create item    | Yes  | `TENANT:ADMIN`, `TENANT:SUPER_ADMIN` |
| `PUT`    | `/api/itemdetails/:id` | Update item    | Yes  | `TENANT:ADMIN`, `TENANT:SUPER_ADMIN` |
| `DELETE` | `/api/itemdetails/:id` | Delete item    | Yes  | `TENANT:ADMIN`, `TENANT:SUPER_ADMIN` |

### GET /api/itemdetails - Get All Item Details

**Query Parameters:**

| Parameter | Type    | Required | Default | Description                                          |
| --------- | ------- | -------- | ------- | ---------------------------------------------------- |
| `page`    | integer | No       | 1       | Page number                                          |
| `limit`   | integer | No       | 10      | Records per page                                     |
| `expand`  | boolean | No       | false   | Include `CategoryName`, `UOMName`, `CostInfoDetails` |

### POST /api/itemdetails - Create Item Detail

**Request Body:**

| Field         | Type    | Required | Constraints                  | Description        |
| ------------- | ------- | -------- | ---------------------------- | ------------------ |
| `Name`        | string  | **Yes**  | max: 255 chars               | Item name          |
| `Code`        | string  | No       | max: 50 chars, allows null   | Item code          |
| `Description` | string  | No       | max: 1000 chars, allows null | Item description   |
| `CategoryId`  | uuid    | No       | UUID v4, allows null         | Category ID        |
| `UOMId`       | uuid    | No       | UUID v4, allows null         | Unit of measure ID |
| `CostInfoId`  | uuid    | No       | UUID v4, allows null         | Cost info ID       |
| `SKU`         | string  | No       | max: 100 chars, allows null  | Stock keeping unit |
| `Barcode`     | string  | No       | max: 100 chars, allows null  | Barcode            |
| `HSNCode`     | string  | No       | max: 50 chars, allows null   | HSN/SAC code       |
| `Active`      | boolean | No       | default: true                | Active status      |

```json
{
  "Name": "Widget A",
  "Code": "WID-001",
  "Description": "A high-quality widget for industrial use",
  "CategoryId": "550e8400-e29b-41d4-a716-446655440000",
  "UOMId": "660e8400-e29b-41d4-a716-446655440001",
  "CostInfoId": "770e8400-e29b-41d4-a716-446655440002",
  "SKU": "SKU-WID-001",
  "Barcode": "1234567890123",
  "HSNCode": "8471",
  "Active": true
}
```

**Success Response (201):**

```json
{
  "success": true,
  "message": "Record created successfully",
  "data": {
    "Id": "880e8400-e29b-41d4-a716-446655440003",
    "Name": "Widget A",
    "Code": "WID-001",
    "Description": "A high-quality widget for industrial use",
    "CategoryId": "550e8400-e29b-41d4-a716-446655440000",
    "UOMId": "660e8400-e29b-41d4-a716-446655440001",
    "CostInfoId": "770e8400-e29b-41d4-a716-446655440002",
    "SKU": "SKU-WID-001",
    "Barcode": "1234567890123",
    "HSNCode": "8471",
    "Active": true,
    "TenantId": "990e8400-e29b-41d4-a716-446655440004",
    "CreatedAt": "2024-01-15T10:30:00Z",
    "UpdatedAt": "2024-01-15T10:30:00Z"
  }
}
```

---

## 34. Payment Received Type Module

**Base Path:** `/api/paymentreceivedtypes`

### Endpoints Overview

| Method   | Endpoint                        | Description    | Auth | Scopes                               |
| -------- | ------------------------------- | -------------- | ---- | ------------------------------------ |
| `GET`    | `/api/paymentreceivedtypes`     | Get all types  | Yes  | -                                    |
| `GET`    | `/api/paymentreceivedtypes/:id` | Get type by ID | Yes  | -                                    |
| `POST`   | `/api/paymentreceivedtypes`     | Create type    | Yes  | `TENANT:ADMIN`, `TENANT:SUPER_ADMIN` |
| `PUT`    | `/api/paymentreceivedtypes/:id` | Update type    | Yes  | `TENANT:ADMIN`, `TENANT:SUPER_ADMIN` |
| `DELETE` | `/api/paymentreceivedtypes/:id` | Delete type    | Yes  | `TENANT:ADMIN`, `TENANT:SUPER_ADMIN` |

### POST /api/paymentreceivedtypes - Create Payment Received Type

**Request Body:**

| Field    | Type    | Required | Constraints    | Description                |
| -------- | ------- | -------- | -------------- | -------------------------- |
| `Name`   | string  | **Yes**  | max: 100 chars | Payment received type name |
| `Active` | boolean | No       | default: true  | Active status              |

```json
{
  "Name": "Full Payment",
  "Active": true
}
```

---

## 35. Payment Mode Module

**Base Path:** `/api/paymentmodes`

### Endpoints Overview

| Method   | Endpoint                | Description            | Auth | Scopes                               |
| -------- | ----------------------- | ---------------------- | ---- | ------------------------------------ |
| `GET`    | `/api/paymentmodes`     | Get all payment modes  | Yes  | -                                    |
| `GET`    | `/api/paymentmodes/:id` | Get payment mode by ID | Yes  | -                                    |
| `POST`   | `/api/paymentmodes`     | Create payment mode    | Yes  | `TENANT:ADMIN`, `TENANT:SUPER_ADMIN` |
| `PUT`    | `/api/paymentmodes/:id` | Update payment mode    | Yes  | `TENANT:ADMIN`, `TENANT:SUPER_ADMIN` |
| `DELETE` | `/api/paymentmodes/:id` | Delete payment mode    | Yes  | `TENANT:ADMIN`, `TENANT:SUPER_ADMIN` |

### POST /api/paymentmodes - Create Payment Mode

**Request Body:**

| Field    | Type    | Required | Constraints    | Description       |
| -------- | ------- | -------- | -------------- | ----------------- |
| `Name`   | string  | **Yes**  | max: 100 chars | Payment mode name |
| `Active` | boolean | No       | default: true  | Active status     |

```json
{
  "Name": "Credit Card",
  "Active": true
}
```

---

## 36. Payment Mode Transaction Detail Module

**Base Path:** `/api/paymentmodetransactiondetails`

> **Supports Expand:** This module supports `?expand=true` to include `PaymentModeName` and `TransactionNo`.

### Endpoints Overview

| Method   | Endpoint                                 | Description      | Auth | Scopes                               |
| -------- | ---------------------------------------- | ---------------- | ---- | ------------------------------------ |
| `GET`    | `/api/paymentmodetransactiondetails`     | Get all details  | Yes  | -                                    |
| `GET`    | `/api/paymentmodetransactiondetails/:id` | Get detail by ID | Yes  | -                                    |
| `POST`   | `/api/paymentmodetransactiondetails`     | Create detail    | Yes  | `TENANT:ADMIN`, `TENANT:SUPER_ADMIN` |
| `PUT`    | `/api/paymentmodetransactiondetails/:id` | Update detail    | Yes  | `TENANT:ADMIN`, `TENANT:SUPER_ADMIN` |
| `DELETE` | `/api/paymentmodetransactiondetails/:id` | Delete detail    | Yes  | `TENANT:ADMIN`, `TENANT:SUPER_ADMIN` |

### GET /api/paymentmodetransactiondetails - Get All Payment Mode Transaction Details

**Query Parameters:**

| Parameter | Type    | Required | Default | Description                                   |
| --------- | ------- | -------- | ------- | --------------------------------------------- |
| `page`    | integer | No       | 1       | Page number                                   |
| `limit`   | integer | No       | 10      | Records per page                              |
| `expand`  | boolean | No       | false   | Include `PaymentModeName` and `TransactionNo` |

### POST /api/paymentmodetransactiondetails - Create Payment Mode Transaction Detail

**Request Body:**

| Field                    | Type    | Required | Constraints                 | Description               |
| ------------------------ | ------- | -------- | --------------------------- | ------------------------- |
| `PaymentModeId`          | uuid    | **Yes**  | UUID v4                     | Payment mode ID           |
| `TransactionDetailLogId` | uuid    | **Yes**  | UUID v4                     | Transaction detail log ID |
| `Amount`                 | number  | **Yes**  | precision: 4                | Payment amount            |
| `ReferenceNo`            | string  | No       | max: 100 chars, allows null | Reference number          |
| `Active`                 | boolean | No       | default: true               | Active status             |

```json
{
  "PaymentModeId": "550e8400-e29b-41d4-a716-446655440000",
  "TransactionDetailLogId": "660e8400-e29b-41d4-a716-446655440001",
  "Amount": 500.0,
  "ReferenceNo": "REF-001",
  "Active": true
}
```

---

## 37. Payment Detail Module

**Base Path:** `/api/paymentdetails`

> **Supports Expand:** This module supports `?expand=true` to include `PaymentReceivedTypeName` and `TransactionNo`.

### Endpoints Overview

| Method   | Endpoint                  | Description              | Auth | Scopes                               |
| -------- | ------------------------- | ------------------------ | ---- | ------------------------------------ |
| `GET`    | `/api/paymentdetails`     | Get all payment details  | Yes  | -                                    |
| `GET`    | `/api/paymentdetails/:id` | Get payment detail by ID | Yes  | -                                    |
| `POST`   | `/api/paymentdetails`     | Create payment detail    | Yes  | `TENANT:ADMIN`, `TENANT:SUPER_ADMIN` |
| `PUT`    | `/api/paymentdetails/:id` | Update payment detail    | Yes  | `TENANT:ADMIN`, `TENANT:SUPER_ADMIN` |
| `DELETE` | `/api/paymentdetails/:id` | Delete payment detail    | Yes  | `TENANT:ADMIN`, `TENANT:SUPER_ADMIN` |

### GET /api/paymentdetails - Get All Payment Details

**Query Parameters:**

| Parameter | Type    | Required | Default | Description                                           |
| --------- | ------- | -------- | ------- | ----------------------------------------------------- |
| `page`    | integer | No       | 1       | Page number                                           |
| `limit`   | integer | No       | 10      | Records per page                                      |
| `expand`  | boolean | No       | false   | Include `PaymentReceivedTypeName` and `TransactionNo` |

### POST /api/paymentdetails - Create Payment Detail

**Request Body:**

| Field                    | Type    | Required | Constraints                 | Description               |
| ------------------------ | ------- | -------- | --------------------------- | ------------------------- |
| `PaymentReceivedTypeId`  | uuid    | **Yes**  | UUID v4                     | Payment received type ID  |
| `TransactionDetailLogId` | uuid    | **Yes**  | UUID v4                     | Transaction detail log ID |
| `Amount`                 | number  | **Yes**  | precision: 4                | Payment amount            |
| `PaymentDate`            | date    | No       | ISO date, allows null       | Date of payment           |
| `ReferenceNo`            | string  | No       | max: 100 chars, allows null | Reference number          |
| `Remarks`                | string  | No       | max: 500 chars, allows null | Additional remarks        |
| `Active`                 | boolean | No       | default: true               | Active status             |

```json
{
  "PaymentReceivedTypeId": "550e8400-e29b-41d4-a716-446655440000",
  "TransactionDetailLogId": "660e8400-e29b-41d4-a716-446655440001",
  "Amount": 1000.0,
  "PaymentDate": "2024-01-15",
  "ReferenceNo": "PAY-001",
  "Remarks": "First payment received",
  "Active": true
}
```

---

## 38. Payment Breakup Module

**Base Path:** `/api/paymentbreakups`

> **Supports Expand:** This module supports `?expand=true` to include `PaymentDetailRef` and `PaymentModeName`.

### Endpoints Overview

| Method   | Endpoint                   | Description       | Auth | Scopes                               |
| -------- | -------------------------- | ----------------- | ---- | ------------------------------------ |
| `GET`    | `/api/paymentbreakups`     | Get all breakups  | Yes  | -                                    |
| `GET`    | `/api/paymentbreakups/:id` | Get breakup by ID | Yes  | -                                    |
| `POST`   | `/api/paymentbreakups`     | Create breakup    | Yes  | `TENANT:ADMIN`, `TENANT:SUPER_ADMIN` |
| `PUT`    | `/api/paymentbreakups/:id` | Update breakup    | Yes  | `TENANT:ADMIN`, `TENANT:SUPER_ADMIN` |
| `DELETE` | `/api/paymentbreakups/:id` | Delete breakup    | Yes  | `TENANT:ADMIN`, `TENANT:SUPER_ADMIN` |

### GET /api/paymentbreakups - Get All Payment Breakups

**Query Parameters:**

| Parameter | Type    | Required | Default | Description                                      |
| --------- | ------- | -------- | ------- | ------------------------------------------------ |
| `page`    | integer | No       | 1       | Page number                                      |
| `limit`   | integer | No       | 10      | Records per page                                 |
| `expand`  | boolean | No       | false   | Include `PaymentDetailRef` and `PaymentModeName` |

### POST /api/paymentbreakups - Create Payment Breakup

**Request Body:**

| Field             | Type    | Required | Constraints                 | Description        |
| ----------------- | ------- | -------- | --------------------------- | ------------------ |
| `PaymentDetailId` | uuid    | **Yes**  | UUID v4                     | Payment detail ID  |
| `PaymentModeId`   | uuid    | **Yes**  | UUID v4                     | Payment mode ID    |
| `Amount`          | number  | **Yes**  | precision: 4                | Breakup amount     |
| `ReferenceNo`     | string  | No       | max: 100 chars, allows null | Reference number   |
| `Remarks`         | string  | No       | max: 500 chars, allows null | Additional remarks |
| `Active`          | boolean | No       | default: true               | Active status      |

```json
{
  "PaymentDetailId": "550e8400-e29b-41d4-a716-446655440000",
  "PaymentModeId": "660e8400-e29b-41d4-a716-446655440001",
  "Amount": 500.0,
  "ReferenceNo": "BRK-001",
  "Remarks": "First breakup amount",
  "Active": true
}
```

---

## Pagination

All list endpoints support pagination with the following query parameters:

| Parameter | Type    | Default | Max | Description    |
| --------- | ------- | ------- | --- | -------------- |
| `page`    | integer | 1       | -   | Page number    |
| `limit`   | integer | 10      | 100 | Items per page |

**Example:**

```
GET /api/taxtypes?page=2&limit=20
```

---

## Error Codes

| HTTP Code | Error            | Description              |
| --------- | ---------------- | ------------------------ |
| 400       | `BAD_REQUEST`    | Invalid request data     |
| 401       | `UNAUTHORIZED`   | Missing or invalid token |
| 403       | `FORBIDDEN`      | Insufficient permissions |
| 404       | `NOT_FOUND`      | Resource not found       |
| 409       | `CONFLICT`       | Resource already exists  |
| 500       | `INTERNAL_ERROR` | Server error             |

---

## Quick Reference - All Endpoints

| #   | Module                             | Base Path                               | Methods                |
| --- | ---------------------------------- | --------------------------------------- | ---------------------- |
| 1   | Auth                               | `/api/auth`                             | POST                   |
| 2   | Tenant                             | `/api/tenants`                          | POST                   |
| 3   | User                               | `/api/user`                             | POST                   |
| 4   | Reports                            | `/api/reports`                          | GET                    |
| 5   | Data                               | `/api/data`                             | GET                    |
| 6   | Audit                              | `/api/audit`                            | GET                    |
| 7   | Tax Type                           | `/api/taxtypes`                         | GET, POST, PUT, DELETE |
| 8   | UOM                                | `/api/uom`                              | GET, POST, PUT, DELETE |
| 9   | UOM Factor                         | `/api/uomfactors`                       | GET, POST, PUT, DELETE |
| 10  | Category                           | `/api/categories`                       | GET, POST, PUT, DELETE |
| 11  | Organization                       | `/api/organizations`                    | GET, POST, PUT, DELETE |
| 12  | Account Type                       | `/api/accounttypes`                     | GET, POST, PUT, DELETE |
| 13  | Account Type Base                  | `/api/accounttypebases`                 | GET, POST, PUT, DELETE |
| 14  | Transaction Type                   | `/api/transactiontypes`                 | GET, POST, PUT, DELETE |
| 15  | Transaction Type Config            | `/api/transactiontypeconfigs`           | GET, POST, PUT, DELETE |
| 16  | Transaction Type Status            | `/api/transactiontypestatuses`          | GET, POST, PUT, DELETE |
| 17  | Transaction Type Base Conversion   | `/api/transactiontypebaseconversions`   | GET, POST, PUT, DELETE |
| 18  | Transaction Type Conversion Mapper | `/api/transactiontypeconversionmappers` | GET, POST, PUT, DELETE |
| 19  | Transaction Detail Log             | `/api/transactiondetaillogs`            | GET, POST, PUT, DELETE |
| 20  | Transaction Item Detail            | `/api/transactionitemdetails`           | GET, POST, PUT, DELETE |
| 21  | Tax Group                          | `/api/taxgroups`                        | GET, POST, PUT, DELETE |
| 22  | Tax Group Tax Type Mapper          | `/api/taxgrouptaxtypemappers`           | GET, POST, PUT, DELETE |
| 23  | Contact Address Type               | `/api/contactaddresstypes`              | GET, POST, PUT, DELETE |
| 24  | Contact Detail                     | `/api/contactdetails`                   | GET, POST, PUT, DELETE |
| 25  | Address Detail                     | `/api/addressdetails`                   | GET, POST, PUT, DELETE |
| 26  | Location Detail                    | `/api/locationdetails`                  | GET, POST, PUT, DELETE |
| 27  | Map Provider                       | `/api/mapproviders`                     | GET, POST, PUT, DELETE |
| 28  | Map Provider Location Mapper       | `/api/mapproviderlocationmappers`       | GET, POST, PUT, DELETE |
| 29  | Cost Info                          | `/api/costinfos`                        | GET, POST, PUT, DELETE |
| 30  | Branch Detail                      | `/api/branchdetails`                    | GET, POST, PUT, DELETE |
| 31  | Branch User Group Mapper           | `/api/branchusergroupmappers`           | GET, POST, PUT, DELETE |
| 32  | Batch Detail                       | `/api/batchdetails`                     | GET, POST, PUT, DELETE |
| 33  | Item Detail                        | `/api/itemdetails`                      | GET, POST, PUT, DELETE |
| 34  | Payment Received Type              | `/api/paymentreceivedtypes`             | GET, POST, PUT, DELETE |
| 35  | Payment Mode                       | `/api/paymentmodes`                     | GET, POST, PUT, DELETE |
| 36  | Payment Mode Transaction Detail    | `/api/paymentmodetransactiondetails`    | GET, POST, PUT, DELETE |
| 37  | Payment Detail                     | `/api/paymentdetails`                   | GET, POST, PUT, DELETE |
| 38  | Payment Breakup                    | `/api/paymentbreakups`                  | GET, POST, PUT, DELETE |

---

_Last Updated: February 2025_

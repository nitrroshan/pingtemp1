# Authentication System Endpoint Specifications

## 1. User Registration Endpoint
- **URL**: `/api/auth/register`
- **Method**: POST
- **Request Body**:
  ```json
  {
    "email": "string",
    "password": "string",
    "name": "string (optional)"
  }
  ```
- **Response**:
  - **201 Created**:
    ```json
    {
      "message": "User registered successfully."
    }
    ```
  - **400 Bad Request**:
    ```json
    {
      "error": "Validation error details."
    }
    ```

---

## 2. User Login Endpoint
- **URL**: `/api/auth/login`
- **Method**: POST
- **Request Body**:
  ```json
  {
    "email": "string",
    "password": "string"
  }
  ```
- **Response**:
  - **200 OK**:
    ```json
    {
      "accessToken": "JWT string",
      "refreshToken": "JWT string (optional)"
    }
    ```
  - **401 Unauthorized**:
    ```json
    {
      "error": "Invalid credentials."
    }
    ```

---

## 3. User Logout Endpoint
- **URL**: `/api/auth/logout`
- **Method**: POST
- **Request Body**: None
- **Response**:
  - **200 OK**:
    ```json
    {
      "message": "Logged out successfully."
    }
    ```

---

## 4. Token Validation Middleware
- **Purpose**: Middleware to secure protected routes by verifying JWT.
- **Implementation**:
  - Extract token from Authorization header (format: `Bearer [token]`).
  - Verify token integrity and expiry.
  - Attach user info to request object if valid.
  - Reject with `401 Unauthorized` if invalid.
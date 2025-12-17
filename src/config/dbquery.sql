CREATE TABLE users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    google_id VARCHAR(255) UNIQUE,
    email VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255),
    role ENUM('admin', 'editor', 'viewer') NOT NULL DEFAULT 'viewer',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Insert sample users for testing authorization
INSERT INTO users (email, role) VALUES ('admin.user@example.com', 'admin');
INSERT INTO users (email, role) VALUES ('editor.user@example.com', 'editor');


--- old data ---

-- Table for Authorization/User Roles
CREATE TABLE users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    roles VARCHAR(255) NOT NULL, -- e.g., 'admin,user:read,user:write'
    name VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Example data:
INSERT INTO users (email, roles, name) VALUES
('testuser@gmail.com', 'user:read,data:read', 'Test User'),
('adminuser@gmail.com', 'admin,user:write,data:write', 'Admin User');
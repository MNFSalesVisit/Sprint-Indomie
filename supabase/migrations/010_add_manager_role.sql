-- Migration 010: Add Manager role
-- Safe to run multiple times

INSERT INTO roles (name) VALUES ('Manager') ON CONFLICT (name) DO NOTHING;

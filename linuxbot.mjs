#!/usr/bin/env node
import 'dotenv/config';
import { start } from './src/linuxbot/start.mjs';

await start();

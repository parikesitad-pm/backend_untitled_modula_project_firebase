import SwaggerParser from '@apidevtools/swagger-parser';
import { getOpenApiDocument } from '../src/openapi/openapi';

async function main() {
  try {
    const doc = getOpenApiDocument();
    // Validate the generated OpenAPI 3.1 document
    const api = await SwaggerParser.validate(doc as any);
    console.log(`OpenAPI validation passed: "${api.info.title}" v${api.info.version}`);
  } catch (err) {
    console.error('OpenAPI validation failed:', err);
    process.exit(1);
  }
}

main();

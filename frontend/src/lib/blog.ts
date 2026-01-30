import fs from 'fs';
import path from 'path';

export interface BlogPost {
  slug: string;
  title: string;
  date: string;
  description?: string;
  content: string;
  image?: string;
}

interface Frontmatter {
  title?: string;
  date?: string;
  description?: string;
  [key: string]: string | undefined;
}

function parseFrontmatter(fileContents: string): { data: Frontmatter; content: string } {
  const lines = fileContents.split('\n');
  
  // Check if file starts with ---
  if (lines[0].trim() !== '---') {
    return { data: {}, content: fileContents };
  }
  
  // Find closing ---
  let endIndex = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      endIndex = i;
      break;
    }
  }
  
  if (endIndex === -1) {
    return { data: {}, content: fileContents };
  }
  
  // Parse frontmatter
  const frontmatterLines = lines.slice(1, endIndex);
  const data: Frontmatter = {};
  
  for (const line of frontmatterLines) {
    const colonIndex = line.indexOf(':');
    if (colonIndex > 0) {
      const key = line.slice(0, colonIndex).trim();
      let value = line.slice(colonIndex + 1).trim();
      // Remove surrounding quotes
      if ((value.startsWith('"') && value.endsWith('"')) || 
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      data[key] = value;
    }
  }
  
  // Get content after frontmatter
  const content = lines.slice(endIndex + 1).join('\n').trim();
  
  return { data, content };
}

function getPostsDirectory() {
  return path.join(process.cwd(), 'content', 'blog');
}

function transformAssetPaths(content: string, slug: string): string {
  // Transform markdown image syntax: ![alt](image.jpg) -> ![alt](/api/blog-images/slug/image.jpg)
  // Only transform relative paths (not starting with / or http)
  let transformed = content.replace(
    /!\[([^\]]*)\]\((?!\/|https?:\/\/)([^)]+)\)/g,
    `![$1](/api/blog-images/${slug}/$2)`
  );
  
  // Transform audio links: [audio](song.mp3) -> [audio](/api/blog-images/slug/song.mp3)
  // Only transform relative paths (not starting with / or http)
  transformed = transformed.replace(
    /\[audio\]\((?!\/|https?:\/\/)([^)]+)\)/gi,
    `[audio](/api/blog-images/${slug}/$1)`
  );
  
  return transformed;
}

export function getAllPosts(): BlogPost[] {
  const postsDirectory = getPostsDirectory();
  
  if (!fs.existsSync(postsDirectory)) {
    return [];
  }
  
  const entries = fs.readdirSync(postsDirectory, { withFileTypes: true });
  const posts = entries
    .filter(entry => entry.isDirectory())
    .map(entry => {
      const slug = entry.name;
      return getPostBySlug(slug);
    })
    .filter((post): post is BlogPost => post !== null)
    .sort((a, b) => (new Date(b.date).getTime() - new Date(a.date).getTime()));

  return posts;
}

export function getPostBySlug(slug: string): BlogPost | null {
  const postsDirectory = getPostsDirectory();
  const fullPath = path.join(postsDirectory, slug, 'index.md');
  
  if (!fs.existsSync(fullPath)) {
    return null;
  }

  const fileContents = fs.readFileSync(fullPath, 'utf8');
  const { data, content } = parseFrontmatter(fileContents);

  // Transform relative asset paths (images, audio) to API paths
  const transformedContent = transformAssetPaths(content, slug);
  
  // Transform frontmatter image if it's a relative path
  let image = data.image;
  if (image && !image.startsWith('/') && !image.startsWith('http')) {
    image = `/api/blog-images/${slug}/${image}`;
  }

  return {
    slug,
    title: data.title || 'Untitled',
    date: data.date || new Date().toISOString().split('T')[0],
    description: data.description,
    content: transformedContent,
    image,
  };
}

export function getAllPostSlugs(): string[] {
  const postsDirectory = getPostsDirectory();
  
  if (!fs.existsSync(postsDirectory)) {
    return [];
  }
  
  const entries = fs.readdirSync(postsDirectory, { withFileTypes: true });
  return entries
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name);
}

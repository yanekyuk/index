/**
 * Interface for scraping web content.
 */
export interface Scraper {
  /**
   * Scrapes the content from the given URL.
   * @param url The URL to scrape.
   * @returns The scraped text content.
   */
  scrape(url: string): Promise<string>;
}

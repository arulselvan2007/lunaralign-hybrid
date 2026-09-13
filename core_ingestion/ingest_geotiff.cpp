/**
 * @file ingest_geotiff.cpp
 * @brief Satellite GeoTIFF ingestion tool using GDAL (LunarAlign-Hybrid).
 * 
 * Features:
 *  - Opens satellite GeoTIFF raster images using the GDAL C++ API.
 *  - Extracts and displays Coordinate Reference System (CRS) metadata (WKT, EPSG, Projection info).
 *  - Reads GeoTransform parameters (geospatial origin, pixel resolution, rotation).
 *  - Slices large satellite images into fixed-size chunks (default: 1024x1024 pixels)
 *    using windowed RasterIO reads to guarantee strictly bounded RAM usage (O(1) memory),
 *    preventing Out-Of-Memory (OOM) crashes on multi-gigabyte rasters.
 *  - Exports each slice into a georeferenced GeoTIFF chunk with updated GeoTransform and CRS.
 *  - Default output target: ../data/tiles/
 */

#include <iostream>
#include <vector>
#include <string>
#include <filesystem>
#include <algorithm>
#include <iomanip>
#include <cstdint>
#include <chrono>

#include "gdal_priv.h"
#include "cpl_conv.h"
#include "cpl_string.h"
#include "ogr_spatialref.h"

namespace fs = std::filesystem;

// Default window dimensions for chunked processing
constexpr int DEFAULT_CHUNK_SIZE = 1024;
constexpr const char *DEFAULT_OUTPUT_DIR = "../data/tiles";

/**
 * Print detailed Coordinate Reference System (CRS) information.
 */
void printCRS(GDALDataset *poDataset) {
    std::cout << "\n=======================================================\n";
    std::cout << "         COORDINATE REFERENCE SYSTEM (CRS)             \n";
    std::cout << "=======================================================\n";

    // Modern GDAL (3.0+) provides GetSpatialRef()
    const OGRSpatialReference *poSRS = poDataset->GetSpatialRef();

    if (poSRS != nullptr) {
        const char *pszName = poSRS->GetName();
        std::cout << "CRS Name:         " << (pszName ? pszName : "Unknown") << "\n";

        const char *pszAuthName = poSRS->GetAuthorityName(nullptr);
        const char *pszAuthCode = poSRS->GetAuthorityCode(nullptr);
        if (pszAuthName && pszAuthCode) {
            std::cout << "Authority / Code: " << pszAuthName << ":" << pszAuthCode << "\n";
        } else {
            std::cout << "Authority / Code: Not directly identified in metadata\n";
        }

        std::cout << "Is Projected:     " << (poSRS->IsProjected() ? "Yes" : "No") << "\n";
        std::cout << "Is Geographic:    " << (poSRS->IsGeographic() ? "Yes" : "No") << "\n";

        // Print human-readable WKT representation
        char *pszWKT = nullptr;
        if (poSRS->exportToPrettyWkt(&pszWKT) == OGRERR_NONE && pszWKT != nullptr) {
            std::cout << "\nWKT Definition:\n" << pszWKT << "\n";
            CPLFree(pszWKT);
        }
    } else {
        // Fallback for unreferenced rasters or older GDAL representations
        const char *pszProjection = poDataset->GetProjectionRef();
        if (pszProjection && strlen(pszProjection) > 0) {
            std::cout << "Legacy WKT:\n" << pszProjection << "\n";
        } else {
            std::cout << "WARNING: No spatial reference system (CRS) found in this GeoTIFF.\n";
        }
    }
}

/**
 * Print GeoTransform and spatial extent information.
 */
void printGeoTransform(const double adfGeoTransform[6], int nRasterXSize, int nRasterYSize) {
    std::cout << "\n=======================================================\n";
    std::cout << "              GEOTRANSFORM & EXTENTS                   \n";
    std::cout << "=======================================================\n";
    std::cout << std::fixed << std::setprecision(8);
    std::cout << "Origin X (Top Left): " << adfGeoTransform[0] << "\n";
    std::cout << "Pixel Width (dx):    " << adfGeoTransform[1] << "\n";
    std::cout << "Rotation X:          " << adfGeoTransform[2] << "\n";
    std::cout << "Origin Y (Top Left): " << adfGeoTransform[3] << "\n";
    std::cout << "Rotation Y:          " << adfGeoTransform[4] << "\n";
    std::cout << "Pixel Height (dy):   " << adfGeoTransform[5] << "\n";

    double x1 = adfGeoTransform[0];
    double y1 = adfGeoTransform[3];
    double x2 = x1 + nRasterXSize * adfGeoTransform[1] + nRasterYSize * adfGeoTransform[2];
    double y2 = y1 + nRasterXSize * adfGeoTransform[4] + nRasterYSize * adfGeoTransform[5];

    double minX = std::min(x1, x2);
    double maxX = std::max(x1, x2);
    double minY = std::min(y1, y2);
    double maxY = std::max(y1, y2);

    std::cout << "Bounding Box Extents:\n";
    std::cout << "  Lower Left:  (" << minX << ", " << minY << ")\n";
    std::cout << "  Upper Right: (" << maxX << ", " << maxY << ")\n";
}

/**
 * Slice the image into chunks and write each chunk as an individual GeoTIFF.
 */
bool sliceGeoTIFF(GDALDataset *poSrcDS,
                  const std::string &outputDir,
                  int chunkSize,
                  bool dryRun) {
    int nRasterXSize = poSrcDS->GetRasterXSize();
    int nRasterYSize = poSrcDS->GetRasterYSize();
    int nBands = poSrcDS->GetRasterCount();

    if (nBands == 0) {
        std::cerr << "Error: Source dataset has 0 raster bands.\n";
        return false;
    }

    GDALRasterBand *poFirstBand = poSrcDS->GetRasterBand(1);
    GDALDataType eDataType = poFirstBand->GetRasterDataType();
    int bytesPerPixel = GDALGetDataTypeSizeBytes(eDataType);

    int numChunksX = (nRasterXSize + chunkSize - 1) / chunkSize;
    int numChunksY = (nRasterYSize + chunkSize - 1) / chunkSize;
    int totalChunks = numChunksX * numChunksY;

    double ramPerChunkMB = (static_cast<double>(chunkSize) * chunkSize * bytesPerPixel * nBands) / (1024.0 * 1024.0);

    std::cout << "\n=======================================================\n";
    std::cout << "                 SLICING SPECIFICATIONS                \n";
    std::cout << "=======================================================\n";
    std::cout << "Raster Dimensions:    " << nRasterXSize << " x " << nRasterYSize << " px\n";
    std::cout << "Bands Count:          " << nBands << "\n";
    std::cout << "Data Type:            " << GDALGetDataTypeName(eDataType) << " (" << bytesPerPixel << " bytes/sample)\n";
    std::cout << "Chunk Grid:           " << numChunksX << " columns x " << numChunksY << " rows\n";
    std::cout << "Total Chunks:         " << totalChunks << "\n";
    std::cout << "Chunk Dimensions:     " << chunkSize << " x " << chunkSize << " px (max)\n";
    std::cout << "RAM per Chunk Buffer: ~" << std::fixed << std::setprecision(2) << ramPerChunkMB << " MB (bounded)\n";
    std::cout << "Output Directory:     " << outputDir << "\n";
    std::cout << "Mode:                 " << (dryRun ? "DRY-RUN (no files will be written)" : "EXPORT CHUNKS") << "\n";
    std::cout << "=======================================================\n\n";

    if (!dryRun) {
        try {
            fs::create_directories(outputDir);
        } catch (const std::exception &ex) {
            std::cerr << "Error creating output directory: " << ex.what() << "\n";
            return false;
        }
    }

    double adfGeoTransform[6];
    bool bHasGeoTransform = (poSrcDS->GetGeoTransform(adfGeoTransform) == CE_None);
    const OGRSpatialReference *poSRS = poSrcDS->GetSpatialRef();

    // Prepare GeoTIFF output driver
    GDALDriver *poDriver = GetGDALDriverManager()->GetDriverByName("GTiff");
    if (!dryRun && poDriver == nullptr) {
        std::cerr << "Error: GeoTIFF driver ('GTiff') is not available in GDAL.\n";
        return false;
    }

    // Allocate a reusable single-band chunk buffer to strictly bound RAM usage
    std::vector<uint8_t> bandBuffer(static_cast<size_t>(chunkSize) * chunkSize * bytesPerPixel);

    auto startTime = std::chrono::steady_clock::now();
    int processedCount = 0;

    for (int chunkY = 0; chunkY < numChunksY; ++chunkY) {
        int yOff = chunkY * chunkSize;
        int actualBlockY = std::min(chunkSize, nRasterYSize - yOff);

        for (int chunkX = 0; chunkX < numChunksX; ++chunkX) {
            int xOff = chunkX * chunkSize;
            int actualBlockX = std::min(chunkSize, nRasterXSize - xOff);
            processedCount++;

            std::string chunkFilename = "chunk_x" + std::to_string(chunkX) +
                                        "_y" + std::to_string(chunkY) + ".tif";
            fs::path chunkPath = fs::path(outputDir) / chunkFilename;

            if (dryRun) {
                if (processedCount <= 5 || processedCount == totalChunks || processedCount % 50 == 0) {
                    std::cout << "[" << std::setw(4) << processedCount << "/" << totalChunks << "] "
                              << "Simulated chunk (" << chunkX << ", " << chunkY << ") "
                              << "Offset: (" << xOff << ", " << yOff << ") "
                              << "Size: " << actualBlockX << "x" << actualBlockY << " px\n";
                }
                continue;
            }

            // GeoTIFF creation options: Deflate compression and tiling
            char **papszOptions = nullptr;
            papszOptions = CSLSetNameValue(papszOptions, "TILED", "YES");
            papszOptions = CSLSetNameValue(papszOptions, "COMPRESS", "DEFLATE");
            papszOptions = CSLSetNameValue(papszOptions, "PREDICTOR", "2");

            GDALDataset *poDstDS = poDriver->Create(
                chunkPath.string().c_str(),
                actualBlockX,
                actualBlockY,
                nBands,
                eDataType,
                papszOptions
            );
            CSLDestroy(papszOptions);

            if (poDstDS == nullptr) {
                std::cerr << "Error creating output file: " << chunkPath << " -> " << CPLGetLastErrorMsg() << "\n";
                return false;
            }

            // Compute updated geotransform for this chunk's origin
            if (bHasGeoTransform) {
                double chunkGeoTransform[6];
                chunkGeoTransform[0] = adfGeoTransform[0] + xOff * adfGeoTransform[1] + yOff * adfGeoTransform[2];
                chunkGeoTransform[1] = adfGeoTransform[1];
                chunkGeoTransform[2] = adfGeoTransform[2];
                chunkGeoTransform[3] = adfGeoTransform[3] + xOff * adfGeoTransform[4] + yOff * adfGeoTransform[5];
                chunkGeoTransform[4] = adfGeoTransform[4];
                chunkGeoTransform[5] = adfGeoTransform[5];

                poDstDS->SetGeoTransform(chunkGeoTransform);
            }

            // Copy CRS
            if (poSRS != nullptr) {
                poDstDS->SetSpatialRef(poSRS);
            }

            // Read from source and write to destination band by band
            for (int bandIdx = 1; bandIdx <= nBands; ++bandIdx) {
                GDALRasterBand *poSrcBand = poSrcDS->GetRasterBand(bandIdx);
                GDALRasterBand *poDstBand = poDstDS->GetRasterBand(bandIdx);

                // Preserve nodata value if present
                int bHasNoData = 0;
                double noDataVal = poSrcBand->GetNoDataValue(&bHasNoData);
                if (bHasNoData) {
                    poDstBand->SetNoDataValue(noDataVal);
                }

                // Windowed read from source: loads ONLY (actualBlockX * actualBlockY) pixels
                CPLErr readErr = poSrcBand->RasterIO(
                    GF_Read,
                    xOff, yOff,
                    actualBlockX, actualBlockY,
                    bandBuffer.data(),
                    actualBlockX, actualBlockY,
                    eDataType,
                    0, 0
                );

                if (readErr != CE_None) {
                    std::cerr << "RasterIO read error at chunk (" << chunkX << ", " << chunkY << ") band " << bandIdx << "\n";
                }

                // Write into chunk dataset
                CPLErr writeErr = poDstBand->RasterIO(
                    GF_Write,
                    0, 0,
                    actualBlockX, actualBlockY,
                    bandBuffer.data(),
                    actualBlockX, actualBlockY,
                    eDataType,
                    0, 0
                );

                if (writeErr != CE_None) {
                    std::cerr << "RasterIO write error at chunk (" << chunkX << ", " << chunkY << ") band " << bandIdx << "\n";
                }
            }

            // Flush and close destination chunk dataset to free disk buffers
            GDALClose(poDstDS);

            if (processedCount % 10 == 0 || processedCount == totalChunks) {
                double pct = (100.0 * processedCount) / totalChunks;
                std::cout << "\rProcessing slices: " << std::fixed << std::setprecision(1)
                          << pct << "% (" << processedCount << "/" << totalChunks << " chunks written)" << std::flush;
            }
        }
    }

    std::cout << "\n";
    auto endTime = std::chrono::steady_clock::now();
    std::chrono::duration<double> elapsed = endTime - startTime;
    std::cout << "Successfully completed in " << std::fixed << std::setprecision(2) << elapsed.count() << " seconds.\n";

    return true;
}

void printUsage(const char *progName) {
    std::cout << "Usage:\n";
    std::cout << "  " << progName << " <input_geotiff_path> [options]\n\n";
    std::cout << "Options:\n";
    std::cout << "  --output-dir, -o <path>   Directory to store chunk files (default: " << DEFAULT_OUTPUT_DIR << ")\n";
    std::cout << "  --chunk-size, -s <size>   Pixel dimensions for square chunks (default: " << DEFAULT_CHUNK_SIZE << ")\n";
    std::cout << "  --dry-run, -d             Inspect CRS, extents, and simulate slicing without writing to disk\n";
    std::cout << "  --help, -h                Show this help message\n\n";
    std::cout << "Example:\n";
    std::cout << "  " << progName << " ../data/raw/lunar_pass1.tif -o ../data/tiles -s 1024\n";
}

int main(int argc, char *argv[]) {
    if (argc < 2) {
        printUsage(argv[0]);
        return 1;
    }

    std::string inputPath = "";
    std::string outputDir = DEFAULT_OUTPUT_DIR;
    int chunkSize = DEFAULT_CHUNK_SIZE;
    bool dryRun = false;

    // Parse command-line arguments
    for (int i = 1; i < argc; ++i) {
        std::string arg = argv[i];
        if (arg == "--help" || arg == "-h") {
            printUsage(argv[0]);
            return 0;
        } else if ((arg == "--output-dir" || arg == "-o") && i + 1 < argc) {
            outputDir = argv[++i];
        } else if ((arg == "--chunk-size" || arg == "-s") && i + 1 < argc) {
            chunkSize = std::stoi(argv[++i]);
            if (chunkSize <= 0) {
                std::cerr << "Error: chunk-size must be a positive integer.\n";
                return 1;
            }
        } else if (arg == "--dry-run" || arg == "-d") {
            dryRun = true;
        } else if (arg.rfind("-", 0) == 0) {
            std::cerr << "Unknown option: " << arg << "\n";
            printUsage(argv[0]);
            return 1;
        } else {
            if (inputPath.empty()) {
                inputPath = arg;
            } else {
                std::cerr << "Unexpected argument: " << arg << "\n";
                printUsage(argv[0]);
                return 1;
            }
        }
    }

    if (inputPath.empty()) {
        std::cerr << "Error: Missing input GeoTIFF file.\n";
        printUsage(argv[0]);
        return 1;
    }

    // Initialize GDAL driver manager
    GDALAllRegister();

    std::cout << "Opening GeoTIFF: " << inputPath << "\n";

    // Open dataset in read-only mode
    GDALDataset *poDataset = static_cast<GDALDataset *>(
        GDALOpen(inputPath.c_str(), GA_ReadOnly)
    );

    if (poDataset == nullptr) {
        std::cerr << "Failed to open input GeoTIFF: " << inputPath << "\n";
        std::cerr << "GDAL Error: " << CPLGetLastErrorMsg() << "\n";
        return 1;
    }

    const char *driverName = poDataset->GetDriver() ? poDataset->GetDriver()->GetDescription() : "Raster";
    std::cout << "Successfully opened image (Driver: " << driverName << ")\n";

    // 1. Read and display CRS
    printCRS(poDataset);

    // 2. Read and display GeoTransform & Extents
    double adfGeoTransform[6];
    if (poDataset->GetGeoTransform(adfGeoTransform) == CE_None) {
        printGeoTransform(adfGeoTransform, poDataset->GetRasterXSize(), poDataset->GetRasterYSize());
    } else {
        std::cout << "\nNotice: No affine geotransform available for this raster.\n";
    }

    // 3. Slice the image into chunks
    bool success = sliceGeoTIFF(poDataset, outputDir, chunkSize, dryRun);

    // Close dataset and cleanup
    GDALClose(poDataset);
    GDALDestroyDriverManager();

    return success ? 0 : 1;
}

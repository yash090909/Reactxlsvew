import React, { useState, useEffect, useCallback, useMemo } from 'react';
// Dexie and XLSX will be accessed from window object
import { FileSpreadsheet, Search, Trash2, UploadCloud, AlertCircle, CheckCircle, Info, XCircle, Loader2 } from 'lucide-react';

// --- Constants ---
const DB_NAME = 'ReactExcelDataDB_V2';
const STORE_NAME = 'excelDataStoreV2';
const METADATA_STORE_NAME = 'fileMetadataV2';
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const SEARCH_DEBOUNCE_MS = 300;
const MAX_SEARCH_RESULTS = 200;

// --- Dexie Database Setup ---
// Declare dbInstance globally, initialized to null.
let dbInstance = null;

// Function to get or initialize the Dexie DB instance
const getDb = () => {
  // Initialize only if not already initialized AND window.Dexie is available
  if (!dbInstance && window.Dexie) {
    console.log("Initializing Dexie DB instance...");
    dbInstance = new window.Dexie(DB_NAME);
    dbInstance.version(3).stores({
      [STORE_NAME]: '++id, fileName, *_searchableTokens', // Index filename and searchable tokens (multiEntry)
      [METADATA_STORE_NAME]: 'fileName, headers' // Store metadata like headers
    }).upgrade(tx => {
      // This upgrade function will only run if the DB is new or the version is an upgrade.
      console.log("Dexie schema version 3 (React) applied/upgraded.");
    });
    console.log("Dexie DB instance initialized and schema configured.");
  } else if (!window.Dexie && !dbInstance) {
    // Log an error if Dexie is not on window when an attempt to initialize is made
    console.error("Dexie.js not found on window object. DB features will be unavailable.");
  }
  return dbInstance;
};


// --- Helper Components ---

// Icon Component
const Icon = ({ icon: IconComponent, size = 16, className = "" }) => (
  <IconComponent size={size} className={className} />
);

// Toast Notification Component
const Toast = ({ message, type, onClose }) => {
  if (!message) return null;

  let bgColor, IconComponent;
  switch (type) {
    case 'success':
      bgColor = 'bg-emerald-500';
      IconComponent = CheckCircle;
      break;
    case 'error':
      bgColor = 'bg-red-500';
      IconComponent = XCircle;
      break;
    default:
      bgColor = 'bg-blue-500';
      IconComponent = Info;
      break;
  }

  return (
    <div
      className={`fixed bottom-5 left-1/2 transform -translate-x-1/2 px-6 py-3 rounded-lg shadow-lg text-white ${bgColor} flex items-center z-50 transition-opacity duration-300`}
    >
      <Icon icon={IconComponent} size={20} className="mr-3" />
      <span>{message}</span>
      <button onClick={onClose} className="ml-4 text-xl font-semibold hover:opacity-75">&times;</button>
    </div>
  );
};

// ProgressBar Component
const ProgressBarComponent = ({ value, label, visible }) => {
  if (!visible) return null;
  return (
    <div className="mt-4">
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      <div className="w-full bg-gray-200 rounded-full h-2.5">
        <div
          className="bg-emerald-500 h-2.5 rounded-full transition-all duration-300 ease-out"
          style={{ width: `${value}%` }}
        ></div>
      </div>
    </div>
  );
};

// --- Main Application Component ---
function App() {
  // --- State Variables ---
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchStatus, setSearchStatus] = useState('');
  const [isSearching, setIsSearching] = useState(false);

  const [storedFiles, setStoredFiles] = useState([]);
  const [isLoadingFiles, setIsLoadingFiles] = useState(true);

  const [fileInputKey, setFileInputKey] = useState(Date.now()); // To reset file input

  const [progress, setProgressState] = useState({ value: 0, label: '', visible: false });
  const [statusMessage, setStatusMessage] = useState('');
  const [toast, setToast] = useState({ message: '', type: '', key: 0 });

  const [footerStatus, setFooterStatus] = useState('Initializing...');
  const [dbReady, setDbReady] = useState(false); // State to track DB readiness

  // --- Utility Functions ---
  const showToast = useCallback((message, type = 'info') => {
    setToast({ message, type, key: Date.now() });
    setTimeout(() => setToast(prev => ({ ...prev, message: '' })), 3000);
  }, []);

  const updateProgress = useCallback((label, value, visible = true) => {
    setProgressState({ label, value, visible });
  }, []);

  // --- Dexie Operations ---

  // Load stored files list
  const loadStoredFilesList = useCallback(async () => {
    const currentDb = getDb(); // Attempt to get/initialize DB
    if (!currentDb) {
      showToast('Database is not available. Cannot load files.', 'error');
      setFooterStatus('Error: DB not ready');
      setIsLoadingFiles(false);
      setDbReady(false);
      return;
    }
    setDbReady(true); // DB is available
    setIsLoadingFiles(true);
    setFooterStatus('Loading stored files...');
    try {
      const filesMetadata = await currentDb[METADATA_STORE_NAME].toArray();
      setStoredFiles(filesMetadata.map(meta => ({ name: meta.fileName, headers: meta.headers })));
      setFooterStatus('Ready');
    } catch (error) {
      console.error("Error loading stored files list:", error);
      showToast('Failed to load stored files.', 'error');
      setFooterStatus('Error loading files');
    } finally {
      setIsLoadingFiles(false);
    }
  }, [showToast]);

  useEffect(() => {
    // This effect tries to initialize the DB and load files.
    // It will retry if Dexie is not immediately available.
    let attempts = 0;
    const maxAttempts = 5;
    let timerId = null;

    const attemptLoad = () => {
      attempts++;
      const currentDb = getDb(); // This will initialize dbInstance if window.Dexie is present
      if (currentDb) {
        setDbReady(true);
        loadStoredFilesList();
      } else if (attempts < maxAttempts) {
        showToast(`Dexie.js not ready, retrying... (Attempt ${attempts}/${maxAttempts})`, 'info');
        setFooterStatus(`DB not ready (attempt ${attempts})`);
        timerId = setTimeout(attemptLoad, 1500 + attempts * 500); // Incremental backoff
      } else {
        showToast('Dexie.js failed to load after multiple attempts. Database features unavailable.', 'error');
        setFooterStatus('Error: Dexie.js missing');
        setIsLoadingFiles(false);
        setDbReady(false);
      }
    };

    attemptLoad(); // Initial attempt

    return () => {
      if (timerId) clearTimeout(timerId); // Cleanup timer on unmount
    };
  }, [loadStoredFilesList, showToast]); // Rerun if these functions change (they are memoized)


  // --- File Upload Handling ---
  const handleFileUpload = async (event) => {
    const currentDb = getDb();
    if (!window.XLSX) {
      showToast('XLSX library (SheetJS) not loaded. Please check your internet or script tags.', 'error');
      return;
    }
    if (!currentDb) {
      showToast('Database not available. Cannot save data.', 'error');
      return;
    }

    const file = event.target.files[0];
    if (!file) return;

    console.log(`File selected: ${file.name}, Size: ${file.size}, Type: ${file.type}`);
    setStatusMessage('');
    updateProgress('Validating file...', 5);

    const allowedExtensions = ['.xlsx', '.xls'];
    const fileExtension = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
    if (!allowedExtensions.includes(fileExtension) || file.size > MAX_FILE_SIZE) {
      showToast(`Invalid file. Please upload .xlsx or .xls (Max ${MAX_FILE_SIZE / 1024 / 1024}MB).`, 'error');
      updateProgress('', 0, false);
      setFileInputKey(Date.now());
      return;
    }

    setFooterStatus(`Reading ${file.name}...`);
    updateProgress('Reading file...', 10);

    try {
      const arrayBuffer = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = e => resolve(e.target.result);
        reader.onerror = err => reject(new Error("Failed to read file."));
        reader.readAsArrayBuffer(file);
      });

      setFooterStatus(`Parsing ${file.name}...`);
      updateProgress('Parsing Excel data (this may take a moment)...', 30);
      await new Promise(resolve => setTimeout(resolve, 50));

      const workbook = window.XLSX.read(arrayBuffer, { type: 'array', cellDates: true });
      const workbookData = [];
      workbook.SheetNames.forEach(sheetName => {
        const sheet = workbook.Sheets[sheetName];
        const rowsArray = window.XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
        if (rowsArray.length > 0) {
          let headerRowIndex = 0;
          while (headerRowIndex < rowsArray.length && rowsArray[headerRowIndex].every(cell => cell === "")) {
            headerRowIndex++;
          }
          if (headerRowIndex >= rowsArray.length) {
            workbookData.push({ sheetName, headers: [], data: [] }); return;
          }
          const headers = rowsArray[headerRowIndex].map(header => String(header || "").trim());
          const data = rowsArray.slice(headerRowIndex + 1).map(rowArray => {
            let rowData = {};
            headers.forEach((header, index) => {
              const rawValue = rowArray[index];
              let stringValue = "";
              if (rawValue instanceof Date) stringValue = !isNaN(rawValue) ? rawValue.toLocaleString() : "";
              else if (rawValue !== null && rawValue !== undefined) stringValue = String(rawValue);
              rowData[header] = stringValue;
            });
            return rowData;
          });
          workbookData.push({ sheetName, headers, data });
        } else {
          workbookData.push({ sheetName, headers: [], data: [] });
        }
      });
      
      if (!workbookData || workbookData.length === 0) throw new Error("Could not read workbook structure or file is empty.");
      let sheetToProcess = workbookData.find(sheet => sheet.data && sheet.data.length > 0);
      if (!sheetToProcess) throw new Error("No data found in any sheet.");
      
      const { sheetName, headers, data } = sheetToProcess;
      const fileIdentifier = `${file.name}::${sheetName}`;

      setFooterStatus(`Checking existing data for ${file.name}...`);
      updateProgress('Checking for existing data...', 70);

      const existingMeta = await currentDb[METADATA_STORE_NAME].get(fileIdentifier);
      if (existingMeta) {
        if (!window.confirm(`Data for "${file.name}" (Sheet: "${sheetName}") already exists. Overwrite?`)) {
          throw new Error("Storage cancelled by user.");
        }
        await currentDb.transaction('rw', currentDb[STORE_NAME], currentDb[METADATA_STORE_NAME], async () => {
            await currentDb[STORE_NAME].where('fileName').equals(fileIdentifier).delete();
            await currentDb[METADATA_STORE_NAME].delete(fileIdentifier);
        });
      }

      setFooterStatus(`Storing data from ${file.name}...`);
      updateProgress('Storing data locally...', 80);
      const dataToStore = data.map(row => ({
        ...row,
        fileName: fileIdentifier,
        _searchableTokens: Object.values(row).flatMap(val => String(val || "").toLowerCase().split(/\s+/)).filter(Boolean)
      }));

      await currentDb.transaction('rw', currentDb[STORE_NAME], currentDb[METADATA_STORE_NAME], async () => {
        await currentDb[METADATA_STORE_NAME].put({ fileName: fileIdentifier, headers: headers });
        await currentDb[STORE_NAME].bulkPut(dataToStore);
      });

      updateProgress('Complete!', 100);
      showToast(`Data from "${file.name}" (Sheet: "${sheetName}") stored successfully!`, 'success');
      setStatusMessage(`"${file.name}" (Sheet: "${sheetName}") processed.`);
      await loadStoredFilesList();

    } catch (error) {
      console.error("Error processing file:", error);
      showToast(`Error: ${error.message}`, 'error');
      setStatusMessage(`Error: ${error.message}`);
      setFooterStatus('Error processing file');
    } finally {
      setFileInputKey(Date.now());
      setTimeout(() => updateProgress('', 0, false), 2500);
      const fStatus = footerStatus; // Capture current footerStatus
      if (fStatus.startsWith('Reading') || fStatus.startsWith('Parsing') || fStatus.startsWith('Storing') || fStatus.startsWith('Checking')) {
          setFooterStatus('Ready');
      }
    }
  };

  // --- Search Functionality ---
  const performSearch = useCallback(async (query) => {
    const currentDb = getDb();
    if (!currentDb) {
      showToast('Database not available. Search unavailable.', 'error');
      setIsSearching(false);
      setSearchStatus('Error: DB missing');
      return;
    }
    if (query.length === 0) {
      setSearchResults([]);
      setSearchStatus('');
      if (footerStatus === 'Searching...') setFooterStatus('Ready');
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    setSearchStatus('Searching...');
    setFooterStatus('Searching...');
    const startTime = performance.now();

    try {
      const keywords = query.toLowerCase().split(/\s+/).filter(k => k.length > 0);
      if (keywords.length === 0) {
        setSearchResults([]);
        setSearchStatus('');
        if (footerStatus === 'Searching...') setFooterStatus('Ready');
        setIsSearching(false);
        return;
      }

      const results = await currentDb[STORE_NAME]
        .where('_searchableTokens')
        .startsWithAnyOfIgnoreCase(keywords)
        .limit(MAX_SEARCH_RESULTS * 5)
        .toArray();

      const filteredResults = results.filter(item => {
        const itemTokens = item._searchableTokens.map(t => t.toLowerCase());
        return keywords.every(kw => itemTokens.some(token => token.includes(kw)));
      }).slice(0, MAX_SEARCH_RESULTS);

      const endTime = performance.now();
      const duration = (endTime - startTime).toFixed(1);
      
      setSearchResults(filteredResults);
      setSearchStatus(`Found ${filteredResults.length} results in ${duration} ms.`);
    } catch (error) {
      console.error("Search error:", error);
      showToast("Error performing search.", 'error');
      setSearchResults([]);
      setSearchStatus('Search error.');
      setFooterStatus('Error during search');
    } finally {
      setIsSearching(false);
      if (footerStatus === 'Searching...') setFooterStatus('Ready');
    }
  }, [showToast, footerStatus]);

  useEffect(() => {
    const currentDb = getDb();
    if (!currentDb && searchTerm) {
        showToast('Database not ready. Search is unavailable.', 'error');
        return;
    }
    if (!searchTerm && searchResults.length === 0 && searchStatus === '') return; 
    
    const handler = setTimeout(() => {
      if (currentDb || !searchTerm) performSearch(searchTerm); // Only search if DB ready or term is empty
    }, SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(handler);
  }, [searchTerm, performSearch, searchResults.length, searchStatus, showToast]);

  const handleSearchChange = (event) => {
    setSearchTerm(event.target.value);
    if (event.target.value) setSearchStatus('Typing...');
    else {
      setSearchStatus('');
      setSearchResults([]);
    }
  };

  // --- Delete File Data ---
  const deleteFileData = async (fileIdentifierToDelete) => {
    const currentDb = getDb();
    if (!currentDb) {
      showToast('Database not available. Cannot delete data.', 'error');
      return;
    }
    if (!window.confirm(`Are you sure you want to delete all data from "${fileIdentifierToDelete}"? This cannot be undone.`)) return;
    
    const fStatus = footerStatus; // Capture before async
    setFooterStatus(`Deleting ${fileIdentifierToDelete}...`);
    try {
      await currentDb.transaction('rw', currentDb[STORE_NAME], currentDb[METADATA_STORE_NAME], async () => {
        await currentDb[STORE_NAME].where('fileName').equals(fileIdentifierToDelete).delete();
        await currentDb[METADATA_STORE_NAME].delete(fileIdentifierToDelete);
      });
      showToast(`Data for "${fileIdentifierToDelete}" deleted successfully.`, 'success');
      await loadStoredFilesList();
      if (searchResults.some(res => res.fileName === fileIdentifierToDelete)) performSearch(searchTerm); 
    } catch (error) {
      console.error("Error deleting file data:", error);
      showToast(`Failed to delete data for "${fileIdentifierToDelete}".`, 'error');
      setFooterStatus('Error deleting file');
    } finally {
        if (fStatus.startsWith('Deleting') || footerStatus.startsWith('Deleting')) setFooterStatus('Ready');
    }
  };

  // --- Memoized Values ---
  const displayedSearchResults = useMemo(() => {
    if (searchResults.length === 0) return [];
    const resultsByFile = searchResults.reduce((acc, row) => {
      const fName = row.fileName;
      if (!acc[fName]) acc[fName] = { rows: [], headers: [] };
      acc[fName].rows.push(row);
      return acc;
    }, {});
    storedFiles.forEach(sf => {
      if (resultsByFile[sf.name]) resultsByFile[sf.name].headers = sf.headers;
    });
    Object.keys(resultsByFile).forEach(fName => {
      if (resultsByFile[fName].headers.length === 0 && resultsByFile[fName].rows.length > 0) {
        resultsByFile[fName].headers = Object.keys(resultsByFile[fName].rows[0]).filter(k => !k.startsWith('_') && k !== 'id' && k !== 'fileName');
      }
    });
    return Object.entries(resultsByFile);
  }, [searchResults, storedFiles]);


  // --- Render Logic ---
  return (
    <div className="flex flex-col min-h-screen bg-gray-100 text-gray-800 font-inter">
      <nav className="bg-emerald-600 shadow-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-center h-16">
            <h1 className="text-xl sm:text-2xl font-bold text-white flex items-center">
              <Icon icon={FileSpreadsheet} size={28} className="mr-2" />
              Offline Excel Viewer (React)
            </h1>
          </div>
        </div>
      </nav>

      <main className="container mx-auto px-4 py-6 sm:px-6 lg:px-8 flex-grow">
        <section className="mb-6 bg-white p-4 sm:p-6 rounded-lg shadow">
          <label htmlFor="searchBox" className="block text-sm font-medium text-gray-700 mb-2">Search Data</label>
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Icon icon={Search} size={20} className="text-gray-400" />
            </div>
            <input
              type="text" id="searchBox" value={searchTerm} onChange={handleSearchChange}
              placeholder="Type keywords to search..."
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-md focus:ring-emerald-500 focus:border-emerald-500 shadow-sm text-sm"
              disabled={!dbReady} // Disable if DB is not ready
            />
          </div>
          <p className="text-xs text-gray-500 mt-1 h-4">
            {isSearching && <Loader2 className="inline-block animate-spin h-3 w-3 mr-1" />}
            {searchStatus}
            {!dbReady && !isLoadingFiles && <span className="text-red-500">Database not available.</span>}
          </p>
        </section>

        <section className="mb-6">
          <h2 className="text-lg font-semibold text-gray-800 mb-2">Results</h2>
          <div 
            id="resultsArea" 
            className="bg-white p-3 sm:p-4 rounded-lg shadow min-h-[200px] max-h-[60vh] overflow-y-auto"
            style={{ WebkitOverflowScrolling: 'touch' }}
          >
            {!dbReady && !isLoadingFiles && (
                <p className="text-center text-red-500 italic mt-4">Database not available. Cannot display results or search.</p>
            )}
            {dbReady && searchTerm && displayedSearchResults.length === 0 && !isSearching && (
              <p className="text-center text-gray-500 italic mt-4">No results found.</p>
            )}
            {dbReady && !searchTerm && storedFiles.length > 0 && displayedSearchResults.length === 0 && (
              <p className="text-center text-gray-500 italic mt-4">Type to search.</p>
            )}
            {dbReady && !searchTerm && storedFiles.length === 0 && displayedSearchResults.length === 0 && (
              <p className="text-center text-gray-500 italic mt-4">Upload a file.</p>
            )}
            {dbReady && displayedSearchResults.map(([fileIdentifier, { rows, headers }]) => (
              <div key={fileIdentifier} className="mb-4">
                {rows.map((row, rowIndex) => (
                  <div key={row.id || rowIndex} className="result-row-react">
                    {headers.map((header, cellIndex) => (
                      <div key={cellIndex} className="result-cell-react">
                        <strong className="text-emerald-700 mr-1.5 font-semibold">{header}:</strong>
                        <span>{String(row[header] || '')}</span>
                      </div>
                    ))}
                     <div className="result-cell-react text-xs text-gray-400 italic text-right" style={{minWidth: 'fit-content', flexBasis: '100%', marginTop: '0.25rem', backgroundColor: 'transparent', boxShadow: 'none'}}>
                        ({fileIdentifier.split('::')[0]} - {fileIdentifier.split('::')[1]})
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </section>

        <section className="mb-6 bg-white p-4 sm:p-6 rounded-lg shadow">
          <h2 className="text-lg font-semibold text-gray-800 mb-3">Upload New File</h2>
          <div className="flex flex-col sm:flex-row sm:items-end gap-4">
            <div className="flex-grow">
              <label htmlFor="fileInput" className="block text-sm font-medium text-gray-700 mb-1">Choose Excel File (.xlsx, .xls)</label>
              <input
                key={fileInputKey} type="file" id="fileInput"
                accept=".xlsx, .xls, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/vnd.ms-excel"
                onChange={handleFileUpload}
                className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-emerald-50 file:text-emerald-700 hover:file:bg-emerald-100 cursor-pointer border border-gray-300 rounded-md p-1"
                disabled={!dbReady} // Disable if DB is not ready
              />
              <p className="text-xs text-gray-500 mt-1">Max file size: {MAX_FILE_SIZE / 1024 / 1024} MB</p>
            </div>
          </div>
          <ProgressBarComponent value={progress.value} label={progress.label} visible={progress.visible} />
          <div className="mt-3 h-5">
            <p className="text-sm text-center font-medium">
                {progress.visible && progress.value === 100 && progress.label === 'Complete!' ? (
                    <span className="text-emerald-600">{statusMessage}</span>
                ) : progress.visible && (progress.label.toLowerCase().includes('error') || statusMessage.toLowerCase().includes('error')) ? (
                    <span className="text-red-600">{statusMessage || progress.label}</span>
                ) : progress.label && progress.label !== 'Complete!' && progress.visible ? (
                    <span className="text-gray-600">{progress.label}</span>
                ) : ( <span className="text-gray-600">{statusMessage}</span> )}
            </p>
          </div>
        </section>

        <section className="mb-6 bg-white p-4 sm:p-6 rounded-lg shadow">
          <h2 className="text-lg font-semibold text-gray-800 mb-3">Stored File Data</h2>
          <div className="border border-gray-200 rounded-md">
            <div className="max-h-60 overflow-y-auto">
              {!dbReady && !isLoadingFiles && (
                  <div className="file-item-react text-gray-500 italic p-3 text-center">Database not available.</div>
              )}
              {dbReady && isLoadingFiles && (
                <div className="file-item-react text-gray-500 italic p-3 text-center">Loading files...</div>
              )}
              {dbReady && !isLoadingFiles && storedFiles.length === 0 && (
                <div className="file-item-react text-gray-500 italic p-3 text-center">No files stored.</div>
              )}
              {dbReady && !isLoadingFiles && storedFiles.map((fileMeta, index) => (
                  <div key={index} className="file-item-react">
                    <span className="truncate" title={fileMeta.name}>
                      <Icon icon={FileSpreadsheet} size={18} className="inline mr-2 text-emerald-600" />
                      {fileMeta.name.split('::')[0]} <span className="text-xs text-gray-500">({fileMeta.name.split('::')[1]})</span>
                    </span>
                    <button onClick={() => deleteFileData(fileMeta.name)} title={`Delete ${fileMeta.name}`} className="delete-button-react" disabled={!dbReady}>
                      <Icon icon={Trash2} size={18} />
                    </button>
                  </div>
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer className="bg-gray-700 text-gray-300 text-center py-3 mt-auto">
        <p className="text-sm">Created By YashPathak09 (React Version)</p>
        <p className="text-xs mt-1">App Status: <span>{footerStatus}</span></p>
      </footer>

      <Toast message={toast.message} type={toast.type} onClose={() => setToast(prev => ({ ...prev, message: '' }))} />

      <style jsx global>{`
        body { font-family: 'Inter', sans-serif; }
        .result-row-react { border-bottom: 1px solid #e5e7eb; padding: 0.75rem 0.5rem; font-size: 0.9em; display: flex; flex-wrap: wrap; gap: 0.5rem; }
        .result-row-react:last-child { border-bottom: none; }
        .result-cell-react { padding: 0.25rem 0.5rem; flex: 1; min-width: 150px; word-break: break-word; background-color: #ffffff; border-radius: 0.375rem; box-shadow: 0 1px 2px 0 rgb(0 0 0 / 0.05); }
        #resultsArea::-webkit-scrollbar { width: 8px; }
        #resultsArea::-webkit-scrollbar-track { background: #e5e7eb; border-radius: 10px; }
        #resultsArea::-webkit-scrollbar-thumb { background-color: #9ca3af; border-radius: 10px; border: 2px solid #e5e7eb; }
        #resultsArea::-webkit-scrollbar-thumb:hover { background-color: #6b7280; }
        .file-item-react { display: flex; justify-content: space-between; align-items: center; padding: 0.75rem 1rem; border-bottom: 1px solid #e5e7eb; }
        .file-item-react:last-child { border-bottom: none; }
        .file-item-react span { word-break: break-all; margin-right: 1rem; flex-grow: 1; }
        .delete-button-react { cursor: pointer; color: #ef4444; transition: color 0.2s ease; flex-shrink: 0; padding: 0.25rem; }
        .delete-button-react:hover { color: #dc2626; }
        .delete-button-react:disabled { color: #9ca3af; cursor: not-allowed; }
        input:disabled { background-color: #f3f4f6; cursor: not-allowed; }
      `}</style>
    </div>
  );
}

export default App;

// To use this React App:
// 1. Ensure React and ReactDOM are in your project.
// 2. Set up Tailwind CSS OR include the Tailwind CDN: <script src="https://cdn.tailwindcss.com"></script>
// 3. Include Dexie.js and SheetJS (xlsx) via CDN BEFORE your React bundle:
//    <script src="https://unpkg.com/dexie@4.0.1/dist/dexie.js"></script>
//    <script src="https://cdn.sheetjs.com/xlsx-0.20.2/package/dist/xlsx.full.min.js"></script>
// 4. Have a root element in HTML: <div id="root"></div>
// 5. Render the App:
//    import React from 'react';
//    import ReactDOM from 'react-dom/client'; // For React 18+
//    import App from './App'; // Assuming this code is in App.js
//    const root = ReactDOM.createRoot(document.getElementById('root'));
//    root.render(<React.StrictMode><App /></React.StrictMode>);
// 6. Ensure 'Inter' font is available (e.g., Google Fonts):
//    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">



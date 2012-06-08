Illymap
=======

Heat & partition maps for the free to play MMOG Illyriad.

Main website for the game: <http://www.illyriad.co.uk/>


Requirements
------------

Browser supporting the minimum WebGL spec. No extra WebGL extensions, but there should be at least 256MB of memory for RTT stuff.
There is also a 300 uniform array of (medium precision) floats that may cause problems on lower end GPUs / WebGL implementations.


Data Files
----------

Illymap uses the following data files provided by Illyriad (though the players file is not yet used):

<http://elgea.illyriad.co.uk/data_downloads/datafile_alliances.xml>
<http://elgea.illyriad.co.uk/data_downloads/datafile_players.xml>
<http://elgea.illyriad.co.uk/data_downloads/datafile_towns.xml>

The server-side is static and datafiles should be manually pulled by hosters from the source and pasted into the data folder.
The "XML2JSON" button should then be used to generate the json data, which should be copied into the data/data.json file.
Note that Illyriad imposes a one download per day restriction for the data files.


Unlicense
---------

Illymap is free and unencumbered public domain software. For more information, see <http://unlicense.org/>.

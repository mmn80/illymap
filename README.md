Illymap
=======

Heat & partition maps for the free to play MMOG Illyriad.

Main website for the game: <http://www.illyriad.co.uk/>


Requirements
------------

Browser supporting WebGL and the OES_texture_float extension. There should be at least 128MB of GPU memory.


Data Files
----------

Illymap uses the following data files provided by Illyriad:

<http://elgea.illyriad.co.uk/data_downloads/datafile_alliances.xml>

<http://elgea.illyriad.co.uk/data_downloads/datafile_towns.xml>

The server-side is static and datafiles should be manually pulled by hosters from the source and pasted into the data folder.
The "XML2JSON" button should then be used to generate the json data (comment the hiding in the stylesheet first), which should be copied into the data/data.json file.
Note that Illyriad imposes a one download per day restriction for the data files.

Code
----

This is my first GPGPU program and it's unoptimized in many ways.
The javascript part is messy and the only good thing about it is that it works.
There are plenty of Gaussian blur shaders on the net, but this one is more general in terms of sigma values and dynamic range.
The iterative compare-and-swap Gaussian partition implementation could also be useful in other apps.
The false color converter is taken from <http://www.efg2.com/Lab/ScienceAndEngineering/Spectra.htm>.


Unlicense
---------

Illymap is free and unencumbered public domain software. For more information, see <http://unlicense.org/>.
